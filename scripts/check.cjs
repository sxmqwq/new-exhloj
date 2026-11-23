const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer; see .node-version');
for (const args of [['scripts/build.cjs', '--check'], ...['dist/exhloj.user.js', 'tests/browser.cjs', 'tests/session.cjs',
  'tests/planner-browser.cjs', 'tests/homework-plan-cache.cjs', 'tests/homework-plan-data.cjs', 'tests/semantic-pdf.cjs', 'tests/fixtures/pdf-text.cjs'].map(file => ['--check', file])]) {
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
}
