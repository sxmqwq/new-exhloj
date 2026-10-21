const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const args of [['scripts/build.cjs', '--check'], ['--check', 'dist/exhloj.user.js'], ['--check', 'tests/browser.cjs']]) {
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
}
