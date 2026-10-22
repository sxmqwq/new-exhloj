const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let source = read('src/exhloj.template.js');
const vendor = read('vendor/markdown-renderer.js').trimEnd();
const notices = read('THIRD_PARTY_NOTICES.txt');
const replaceOnce = (text, token, content) => {
  if (text.split(token).length !== 2) throw new Error(`Expected exactly one ${token}`);
  return text.replace(token, () => content);
};
source = replaceOnce(source, '/* @EXHLOJ_MARKDOWN_VENDOR@ */', vendor);
source = replaceOnce(source, '/* @EXHLOJ_PINYIN_VENDOR@ */', read('vendor/pinyin.js').trimEnd());
source = replaceOnce(source, '/* @EXHLOJ_THIRD_PARTY_LICENSES@ */', `/* THIRD-PARTY LICENSE NOTICES\n${notices}\n\n*/\n`);
const version = require('../package.json').version;
if (!source.includes(`// @version      ${version}\n`) || !source.includes(`const VERSION = '${version}';`)) throw new Error('package.json and userscript versions differ');
const output = path.join(root, 'dist/exhloj.user.js');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || read('dist/exhloj.user.js') !== source) throw new Error('dist/exhloj.user.js differs from source; run npm run build');
  console.log(`Build matches checked-in script (${version}).`);
} else {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, source);
  console.log(`Built dist/exhloj.user.js (${version}, ${Buffer.byteLength(source)} bytes).`);
}
