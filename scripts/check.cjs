const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer; see .node-version');
for (const args of [['scripts/build.cjs', '--check'], ['--check', 'dist/exhloj.user.js'], ['--check', 'tests/browser.cjs'], ['--check', 'tests/session.cjs']]) {
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
}
