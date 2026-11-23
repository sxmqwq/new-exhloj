import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));

// PDF.js exports globals for its generic viewer. The userscript has its own copy.
const isolate = {
  name: 'private-pdfjs',
  setup(builder) {
    builder.onLoad({ filter: /[\\/]pdfjs-dist[\\/]build[\\/]pdf(?:\.worker)?\.mjs$/ }, async ({ path }) => {
      const source = await readFile(path, 'utf8');
      const globalExport = /^globalThis\.pdfjs(?:Lib|Worker) = \{\r?\n[\s\S]*?^\};\r?$/gm;
      if ([...source.matchAll(globalExport)].length !== 1) throw new Error('Check PDF.js global exports before upgrading');
      // PDF fingerprints use the ES2025 typed-array hex methods. Keep this conversion inside the bundle.
      const output = source.replace(globalExport, '')
        .replace('hashOriginal.toHex(), hashModified?.toHex() ?? null', 'pdfHex(hashOriginal), hashModified ? pdfHex(hashModified) : null');
      return { contents: output, loader: 'js' };
    });
  },
};
async function bundle(exports, file, globalName) {
  const result = await build({
    absWorkingDir: root, stdin: { contents: 'export { ' + exports + ' } from "pdfjs-dist/build/' + file + '";', resolveDir: root },
    bundle: true, minify: true, platform: 'browser', format: 'iife', globalName, target: 'es2022',
    legalComments: 'none',
    define: { 'import.meta.url': '""', process:'undefined', Map:'PdfMap', WeakMap:'PdfWeakMap', 'Promise.try':'pdfTry',
      'Promise.withResolvers':'pdfPromise', 'Math.sumPrecise':'pdfSum', 'Uint8Array.fromBase64':'pdfFromBase64' },
    plugins: [isolate], write: false,
  });
  return result.outputFiles[0].text.trimEnd();
}
const [main, worker] = await Promise.all([
  bundle('getDocument, PDFWorker', 'pdf.mjs', 'ExhlojPdfMain'),
  bundle('WorkerMessageHandler', 'pdf.worker.mjs', 'ExhlojPdfWorker'),
]);
const cmaps = new URL('cmaps/', packageRoot);
const selected = (await readdir(cmaps)).filter(name => /^(?:Adobe-(?:GB1|CNS1)|(?:CNS|UniCNS|GB|UniGB|B5|ET|HK))[^/]*\.bcmap$/.test(name)).sort();
const data = Object.fromEntries(await Promise.all(selected.map(async name => [name, (await readFile(new URL(name, cmaps))).toString('base64')])));
const packed = gzipSync(JSON.stringify(data), { level: 9 }).toString('base64');
// PDF.js 6 uses newer JS built-ins. Provide local fallbacks without changing the judge page's prototypes.
const compatibility = [
  'const pdfHex = value => Array.from(value, n => n.toString(16).padStart(2, "0")).join("");',
  'const pdfFromBase64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));',
  'const pdfTry = (fn, ...args) => new Promise(resolve => resolve(fn(...args)));',
  'const pdfPromise = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };',
  'const pdfSum = Math.sumPrecise || (values => Array.from(values).reduce((a, b) => a + b, 0));',
  'const mapCompat = Class => class extends Class {',
  '  getOrInsert(k, value) { if (!this.has(k)) this.set(k, value); return this.get(k); }',
  '  getOrInsertComputed(k, compute) { if (!this.has(k)) this.set(k, compute(k)); return this.get(k); }',
  '};',
  'const PdfMap = Map.prototype.getOrInsertComputed ? Map : mapCompat(Map);',
  'const PdfWeakMap = WeakMap.prototype.getOrInsertComputed ? WeakMap : mapCompat(WeakMap);',
].join('\n');
const output = [
  '// PDF.js ' + version + ' (Apache-2.0) and Adobe Chinese CMaps (BSD-3-Clause). See THIRD_PARTY_NOTICES.txt.',
  '  let exhlojPdfEngine;',
  '  function getExhlojPdfEngine() {',
  '    if (exhlojPdfEngine) return exhlojPdfEngine;',
  '    function startExhlojPdfWorker() {',
  compatibility,
  worker,
  '      return ExhlojPdfWorker.WorkerMessageHandler;',
  '    }',
  compatibility,
  main,
  '    const cmapData = ' + JSON.stringify(packed) + ';',
  '    let cmaps;',
  '    class LocalPdfData {',
  '      async fetch({ kind, filename }) {',
  '        if (kind !== "cMapUrl") throw new Error("No external PDF resources are loaded");',
  '        cmaps ??= new Response(new Blob([Uint8Array.from(atob(cmapData), c => c.charCodeAt(0))]).stream()',
  '          .pipeThrough(new DecompressionStream("gzip"))).json();',
  '        const values = await cmaps;',
  '        if (!Object.hasOwn(values, filename)) throw new Error("This PDF character map is not bundled");',
  '        return Uint8Array.from(atob(values[filename]), c => c.charCodeAt(0));',
  '      }',
  '    }',
  '    return exhlojPdfEngine = { ...ExhlojPdfMain, startExhlojPdfWorker, LocalPdfData };',
  '  }',
].join('\n') + '\n';
await writeFile(new URL('../vendor/pdf-text-engine.js', import.meta.url), output);
console.log('Rebuilt local PDF text engine (' + version + ', ' + selected.length + ' Chinese CMaps).');
