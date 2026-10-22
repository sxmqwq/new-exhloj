import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  absWorkingDir: root,
  entryPoints: ['vendor/markdown-entry.mjs'],
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'ExhlojMarkdown',
  target: 'es2022',
  legalComments: 'inline',
  write: false,
});
await writeFile(new URL('../vendor/markdown-renderer.js', import.meta.url), '  ' + result.outputFiles[0].text.trimEnd() + '\n');
console.log('Rebuilt vendored Markdown renderer. Run npm run build and npm test before committing.');

const pinyin = await build({
  absWorkingDir: root, entryPoints: ['vendor/pinyin-entry.mjs'], bundle: true, minify: true,
  platform: 'browser', format: 'iife', globalName: 'ExhlojPinyin', target: 'es2022', legalComments: 'inline', write: false,
});
await writeFile(new URL('../vendor/pinyin.js', import.meta.url), '  ' + pinyin.outputFiles[0].text.trimEnd() + '\n');
console.log('Rebuilt vendored offline pinyin dictionary.');
