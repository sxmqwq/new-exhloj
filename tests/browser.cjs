const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const script = fs.readFileSync(require('node:path').join(__dirname, '../dist/exhloj.user.js'), 'utf8');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
process.chdir(root);
fs.mkdirSync('tests/output', { recursive: true });
const checks = [];
let browser;
const html = (name, body = '', extra = '') => `<!doctype html><html data-page="${name}"><head><meta charset="utf-8"><title>Fixture</title></head>
<body class="page--${name}"><div class="main"><div class="row"><div class="medium-9 columns">${body}</div><div class="medium-3 columns"></div></div></div>${extra}</body></html>`;
async function fixture(name, body, context = {}, options = {}) {
  const page = await browser.newPage();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request();
    requests.push({ url: req.url(), method: req.method(), kind: req.resourceType(), data: req.postData(), headers: req.headers() });
    if (req.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: html(name, body, options.extra) });
    if (options.api) {
      const u = new URL(req.url());
      const spec = typeof options.api === 'function' ? await options.api(req) : options.api[`${req.method()} ${u.pathname}${u.search}`] || options.api[`${req.method()} ${u.pathname}`];
      if (spec) {
        if (spec.delay) await new Promise(resolve => setTimeout(resolve, spec.delay));
        try { return await route.fulfill({ status: spec.status || 200, contentType: spec.contentType || (spec.bytes ? 'application/octet-stream' : 'application/json'),
          headers: spec.headers || {}, body: spec.bytes ? Buffer.from(spec.bytes) : spec.text ?? JSON.stringify(spec.body ?? {}) }); } catch { return; }
      }
      if (options.strictApi) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected test endpoint' }) });
    }
    return route.fulfill({ status: options.status || 200, contentType: options.invalidJSON ? 'text/html' : 'application/json',
      body: options.invalidJSON ? '<html>login</html>' : JSON.stringify(req.method() === 'POST' ? { url: '/file/new-avatar.png' } : options.json || {}) });
  });
  await page.addInitScript(({ context, storage, remote, userId }) => {
    window.UiContext = context;
    window.UserContext = { _id: userId, bio: '<!-- exhloj: old marker -->' };
    window.unsafeWindow = window;
    window.__store = storage;
    window.__gm = [];
    window.__commands = [];
    window.__clipboard = [];
    window.__remote = remote;
    window.GM_getValue = (key, fallback) => Object.hasOwn(window.__store, key) ? window.__store[key] : fallback;
    window.GM_setValue = (key, value) => { window.__store[key] = value; };
    window.GM_registerMenuCommand = (name, fn) => window.__commands.push({ name, fn });
    window.GM_xmlhttpRequest = options => {
      if (options.method === 'GET') {
        window.__gm.push({ url: options.url, method: 'GET', headers: options.headers, anonymous: options.anonymous });
        const response = window.__remote[options.url];
        if (!response) return queueMicrotask(() => options.onerror(new Error('Unexpected external URL')));
        return setTimeout(() => options.onload({ status: response.status || 200,
          responseText: response.text ?? JSON.stringify(response.json), finalUrl: response.finalUrl || options.url }), response.delay || 0);
      }
      window.__gm.push({ url: options.url, method: options.method, payload: JSON.parse(options.data) });
      options.onload({ status: 200 });
    };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => window.__clipboard.push(text) }, configurable: true });
  }, { context, storage: options.storage || {}, remote: options.remote || {}, userId: options.userId ?? 42 });
  await page.goto(`https://oj.hailiangedu.com${options.path || '/d/test/p/P1'}`);
  await page.addScriptTag({ content: script });
  return { page, errors, requests, async done() {
    assert.deepEqual(errors, [], 'No uncaught exceptions');
    assert.ok(requests.every(r => new URL(r.url).origin === 'https://oj.hailiangedu.com' || (options.attachments || []).includes(r.url) || (r.kind === 'image' && new URL(r.url).protocol === 'https:')), 'Only same-site active requests, explicit attachment links and passive Markdown images');
    await page.close();
  } };
}
async function check(name, work) {
  if (process.env.EXHLOJ_TEST_FILTER && !name.includes(process.env.EXHLOJ_TEST_FILTER)) return;
  await work(); checks.push(name); console.log('PASS', name);
}
(async () => {
  browser = await chromium.launch({ ...(process.env.EXHLOJ_CHROME ? { executablePath: process.env.EXHLOJ_CHROME } : {}), headless: true, args: ['--no-sandbox'] });
  await check('core: guest fallback, lazy user menu, deduplication, no automatic writes/requests', async () => {
    const f = await fixture('homepage', '<div class="section">Hi</div>'); const { page } = f;
    assert.equal(await page.locator('[data-exh-fallback]').count(), 1);
    await page.locator('[data-exh-fallback]').click();
    assert.equal(await page.locator('#exhloj-local-dialog').isVisible(), true);
    await page.locator('[data-exh-action="close"]').click();
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<ol id="menu-nav-user"><li><a href="/file">Files</a></li><li><a href="/home/domain">Domains</a></li><li><a href="Error: No route found for name: x">Broken</a></li></ol>'));
    await page.waitForSelector('.exhloj-local-menu');
    await page.addScriptTag({ content: script });
    await page.waitForTimeout(450);
    assert.equal(await page.locator('.exhloj-local-menu').count(), 1);
    assert.equal(await page.locator('[data-exh-fallback]').count(), 0);
    assert.equal(await page.locator('a[href="/home/domain"]').count(), 1);
    assert.equal(await page.locator('a[href^="Error:"]').count(), 0);
    assert.equal(f.requests.length, 1); assert.deepEqual(await page.evaluate(() => window.__gm), []);
    assert.equal(await page.evaluate(() => window.UserContext.bio), '<!-- exhloj: old marker -->');
    await f.done();
  });
  await check('core: save UI switch and preserve ports across reinstall/page load', async () => {
    const f = await fixture('homepage', '');
    await f.page.locator('[data-exh-fallback]').click();
    await f.page.locator('[name="ui"]').uncheck();
    await f.page.locator('[name="cphPort"]').fill('12345');
    await f.page.locator('[data-exh-action="save-settings"]').click();
    const storage = await f.page.evaluate(() => window.__store); await f.done();
    const g = await fixture('problem_detail', '<ul class="problem__tags"></ul>', { pdoc: { content: 'test' } }, { storage });
    assert.equal(await g.page.locator('#exhloj-local-problem-tools').count(), 0);
    assert.equal(await g.page.locator('html.exhloj-local-rounded').count(), 0);
    assert.equal(await g.page.locator('[data-exh-fallback]').count(), 1); await g.done();
  });
  await check('core: JSON round trip, invalid imports atomic, sensitive legacy keys excluded, safe cache rendering', async () => {
    const f = await fixture('homepage', ''); const { page } = f;
    await page.locator('[data-exh-fallback]').click();
    const data = { format: 'exhloj-core-ui', schemaVersion: 1, settings: { ui: true }, cache: {
      'exhloj.user': { title: '<img src=x onerror="window.injected=1">' }, 'exhloj.token': 'secret', 'exhloj.passwords': [{ password: 'secret' }] } };
    await page.locator('#exhloj-local-import').fill(JSON.stringify(data));
    await page.locator('[data-exh-action="import"]').click();
    const before = await page.evaluate(() => JSON.stringify(window.__store));
    await page.locator('#exhloj-local-import').fill(JSON.stringify({ ...data, settings: { cphPort: 999999 } }));
    await page.locator('[data-exh-action="import"]').click();
    assert.equal(await page.evaluate(() => JSON.stringify(window.__store)), before);
    await page.locator('[data-exh-action="view-cache"]').click();
    const text = await page.locator('#exhloj-local-dialog pre').innerText();
    assert.ok(!text.includes('secret')); assert.equal(await page.locator('#exhloj-local-dialog img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    const result = JSON.parse(text); assert.deepEqual(Object.keys(result.cache), ['exhloj.user']);
    assert.equal(result.settings.ui, true); await f.done();
  });
  await check('core: downloadable backup is valid UTF-8 JSON; settings dialog fits desktop and mobile', async () => {
    const f = await fixture('homepage', ''); const { page } = f;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('[data-exh-fallback]').click();
    await page.screenshot({ path: 'tests/settings-desktop.png' });
    const waiting = page.waitForEvent('download');
    await page.locator('[data-exh-action="export"]').click();
    const download = await waiting;
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(backup.format, 'exhloj'); assert.equal(backup.schemaVersion, 1);
    await page.setViewportSize({ width: 400, height: 800 });
    await page.screenshot({ path: 'tests/settings-mobile.png' });
    const bounds = await page.locator('#exhloj-local-dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 400);
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 800); await f.done();
  });
  await check('ui: exact multilingual Markdown and CPH payload, sends only to chosen local endpoint', async () => {
    const body = '<div class="section__body"><ul class="problem__tags"></ul></div><pre><code class="language-input1">1 &lt; 2\n</code></pre><pre><code class="language-output1">3\n</code></pre>';
    const f = await fixture('problem_detail', body, { domain: { _id: 'test' }, pdoc: { _id: 'problem1', title: 'Title', content: JSON.stringify({ en: 'English', zh: '# 中文\n\n$x&lt;y$' }), config: { timeMax: 2000, memoryMax: 512, subType: 'a', type: 'interactive' } }, tdoc: { _id: 'contest1', title: 'Round', pids: [1, 2, 3] } });
    await f.page.locator('[data-exh-action="problem-copy"]').click();
    assert.deepEqual(await f.page.evaluate(() => window.__clipboard), ['# 中文\n\n$x&lt;y$']);
    await f.page.locator('[data-exh-action="cph"]').click();
    let gm = await f.page.evaluate(() => window.__gm);
    assert.equal(gm.length, 1); assert.equal(gm[0].url, 'http://localhost:27121/');
    assert.deepEqual(gm[0].payload.tests, [{ input: '1 < 2\n', output: '3\n' }]);
    assert.equal(gm[0].payload.batch.size, 1); assert.equal(gm[0].payload.interactive, true);
    assert.equal(gm[0].payload.input.fileName, 'a.in');
    assert.equal(gm[0].payload.memoryLimit, 512); assert.equal(gm[0].payload.timeLimit, 2000);
    await f.page.locator('[data-exh-action="editor"]').click();
    gm = await f.page.evaluate(() => window.__gm); assert.equal(gm.length, 2); assert.equal(gm[1].url, 'http://localhost:10045/');
    assert.equal(f.requests.length, 1); await f.done();
  });
  await check('ui: delayed context and JSON fallback for problem copying', async () => {
    const f = await fixture('problem_detail', '<ul class="problem__tags"></ul>', {}, { json: { pdoc: { title: 'Server', content: '# exact\n', config: {} } } });
    await f.page.locator('[data-exh-action="problem-copy"]').click();
    await f.page.waitForFunction(() => window.__clipboard.length === 1);
    assert.deepEqual(await f.page.evaluate(() => window.__clipboard), ['# exact\n']);
    await f.page.locator('[data-exh-action="problem-copy"]').click();
    assert.equal(f.requests.length, 2); assert.equal(f.requests[1].method, 'GET'); await f.done();
  });
  await check('ui: homework title/files, filename encoding and no duplicate tables', async () => {
    const f = await fixture('homework_detail', '<div class="section"><div class="section__header"><h1>Homework Introduction</h1></div></div>', {}, { json: { tdoc: { _id: 'hw', title: '<b>Title</b>', files: [{ name: 'a #&中文.txt', size: 2048 }] } } });
    await f.page.waitForSelector('#exhloj-local-homework-files');
    assert.equal(await f.page.locator('.section__header h1').first().innerText(), 'Homework Introduction - <b>Title</b>');
    const href = await f.page.locator('#exhloj-local-homework-files a').getAttribute('href');
    assert.equal(href, '/d/test/homework/hw/file/a%20%23%26%E4%B8%AD%E6%96%87.txt');
    assert.equal(await f.page.locator('#exhloj-local-homework-files .col--size').innerText(), '2.0 KiB');
    await f.page.evaluate(() => document.body.append(document.createElement('p')));
    await f.page.waitForTimeout(450);
    assert.equal(await f.page.locator('#exhloj-local-homework-files').count(), 1); assert.equal(f.requests.length, 2); await f.done();
  });
  await check('ui: dynamic scoreboard medals and visible earliest record recalculation', async () => {
    const f = await fixture('homework_scoreboard', '<h2 class="text-center">Round</h2><div class="section__table-container"><table class="data-table"><tbody><tr><td class="col--rank">1</td><td class="col--problem"><a href="/record/680000020000000000000001">50</a></td></tr><tr><td class="col--rank">2</td><td class="col--problem"><a href="/record/680000010000000000000001">100</a></td></tr></tbody></table></div>', {}, { path: '/d/test/homework/hw/scoreboard' });
    assert.equal(await f.page.locator('.exhloj-local-medal').count(), 2);
    assert.equal(await f.page.locator('.exhloj-local-earliest').innerText(), '100 ◷');
    await f.page.locator('tbody tr').first().locator('.col--problem').evaluate(node => { node.innerHTML = '<a href="/record/680000000000000000000001">20</a>'; });
    await f.page.waitForFunction(() => document.querySelector('.exhloj-local-earliest')?.textContent.includes('20'));
    assert.equal(await f.page.locator('.exhloj-local-earliest').count(), 1);
    assert.equal(await f.page.locator('.exhloj-local-earliest-label').count(), 1);
    assert.equal(await f.page.locator('h2 a').getAttribute('href'), '/d/test/homework/hw'); await f.done();
  });
  await check('ui: solution Markdown by ID, including permission-denied/missing records', async () => {
    const body = '<ul class="dczcomments__list view--solution"><li class="dczcomments__item"><div class="media"><div class="media__left top"></div><div class="typo richmedia" data-raw-url="/d/test/p/P1/solution/sol1/raw">Rendered</div></div></li></ul>';
    const f = await fixture('problem_solution', body, {}, { json: { psdocs: [{ _id: 'sol1', content: '**raw**\n' }] } });
    assert.equal(f.requests.length, 1);
    await f.page.locator('[data-exh-action="solution-copy"]').click();
    await f.page.waitForFunction(() => window.__clipboard.length === 1);
    assert.deepEqual(await f.page.evaluate(() => window.__clipboard), ['**raw**\n']);
    await f.page.locator('[data-exh-action="solution-copy"]').evaluate(node => node.dataset.solutionId = 'missing');
    await f.page.locator('[data-exh-action="solution-copy"]').click();
    assert.match(await f.page.locator('#exhloj-local-toast').innerText(), /没有找到/); await f.done();
  });
  await check('ui: avatar only writes on click, URL validation, no unrelated account mutations', async () => {
    const f = await fixture('home_account', '<div class="section"><h1>Account</h1></div>');
    assert.equal(f.requests.length, 1);
    await f.page.locator('[name="exhloj-local-avatar-url"]').fill('javascript:alert(1)');
    await f.page.locator('[data-exh-action="avatar-save"]').click(); assert.equal(f.requests.length, 1);
    await f.page.locator('[name="exhloj-local-avatar-url"]').fill('/file/42/pic.png');
    await f.page.locator('[data-exh-action="avatar-save"]').click();
    await f.page.waitForFunction(() => document.querySelector('#exhloj-local-toast')?.textContent.includes('已更新'));
    assert.equal(f.requests.length, 2); assert.equal(f.requests[1].method, 'POST');
    assert.equal(f.requests[1].url, 'https://oj.hailiangedu.com/home/avatar');
    assert.deepEqual(JSON.parse(f.requests[1].data), { avatar: 'url:https://oj.hailiangedu.com/file/42/pic.png' }); await f.done();
  });
  await check('ui: 71-bit permission value and escaped role strings', async () => {
    const f = await fixture('user_detail', '', { udoc: { perm: `BigInt::${(1n << 70n) | (1n << 67n) | 1n}`, role: '<script>bad</script>' } });
    assert.match(await f.page.locator('#exhloj-local-permissions').innerText(), /\(3\)/);
    await f.page.locator('[data-exh-action="permissions"]').click();
    assert.equal(await f.page.locator('#exhloj-local-dialog script').count(), 0);
    assert.equal(await f.page.locator('#exhloj-local-dialog td').filter({ hasText: /^✓$/ }).count(), 3); await f.done();
  });
  await check('core: no context, corrupt storage, failed OJ JSON cause a visible error without request loops', async () => {
    const f = await fixture('problem_detail', '<ul class="problem__tags"></ul>', {}, { invalidJSON: true, storage: { 'exhloj.coreui.settings.v1': 'broken JSON' } });
    await f.page.locator('[data-exh-action="problem-copy"]').click();
    await f.page.waitForFunction(() => document.querySelector('#exhloj-local-toast')?.textContent.includes('JSON'));
    await f.page.waitForTimeout(1200);
    assert.equal(f.requests.length, 2); await f.done();
  });
  await check('core: event replay, listener-free broadcasts and SPA route refresh', async () => {
    const f = await fixture('homepage', '<ul class="problem__tags"></ul>');
    const result = await f.page.evaluate(async () => {
      const core = window.UiContext.exhloj.core;
      core.broadcast('no-listeners', 7);
      let value = 0; core.on('no-listeners', data => { value = data; });
      await Promise.resolve();
      history.pushState({}, '', '/d/test/p/2');
      document.documentElement.dataset.page = 'problem_detail';
      window.UiContext.pdoc = { content: 'new route', config: {}, title: 'New' };
      return value;
    });
    assert.equal(result, 7);
    await f.page.waitForSelector('[data-exh-action="problem-copy"]');
    await f.page.locator('[data-exh-action="problem-copy"]').click();
    assert.deepEqual(await f.page.evaluate(() => window.__clipboard), ['new route']); await f.done();
  });
  const noAuto = { 'exhloj.coreui.settings.v1': JSON.stringify({ remoteAuto: false }) };
  const remoteBody = '<div class="section__body"><ul class="problem__tags"></ul></div>';
  const originContext = (subType, target) => ({ domain: { _id: 'test' }, pdoc: { docId: 10, title: 'Remote', pid: 'P10', content: 'Statement', config: { type: 'remote_judge', subType, target } } });
  const metaURL = 'https://www.luogu.com.cn/problem/P1001';
  const sampleMeta = { data: { problem: { pid: 'P1001', name: 'A+B', difficulty: 1, content: { name: 'A+B', description: '$a+b$', formatI: 'two integers', formatO: 'sum', locale: 'zh-CN' }, samples: [['1 2', '3']] } } };
  const solutionsURL = number => `https://www.luogu.com.cn/problem/solution/P1001?page=${number}`;
  await check('captcha: real SVG auto-fill, fold/show, preserved password and no automatic login', async () => {
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/captcha-real.json', 'utf8'));
    const login = '<form><input name="uname" value="test-user"><input name="password" type="password" value="unchanged-secret"><div class="row"><input name="captcha"></div><label><input name="rememberme" type="checkbox">Remember</label><button>Login</button></form>';
    const f = await fixture('user_login', login, { captcha: sample.data });
    await f.page.waitForFunction(text => document.querySelector('[name=captcha]').value === text, sample.text);
    assert.equal(await f.page.locator('[name="captcha"]').isVisible(), false);
    assert.equal(await f.page.locator('[name="password"]').inputValue(), 'unchanged-secret');
    assert.equal(await f.page.locator('[name="password"]').isVisible(), true);
    assert.equal(await f.page.locator('[name="rememberme"]').isChecked(), false);
    await f.page.locator('[data-exh-action="captcha-toggle"]').click();
    assert.equal(await f.page.locator('[name="captcha"]').isVisible(), true);
    await f.page.locator('[name="captcha"]').fill('manual');
    await f.page.evaluate(() => document.body.append(document.createElement('p')));
    await f.page.waitForTimeout(300);
    assert.equal(await f.page.locator('[name="captcha"]').inputValue(), 'manual');
    assert.ok(!(await f.page.evaluate(() => JSON.stringify(window.__store))).includes('unchanged-secret'));
    assert.equal(f.requests.length, 1); assert.deepEqual(await f.page.evaluate(() => window.__gm), []); await f.done();
  });
  await check('captcha: new unrecognized SVG clears stale auto-fill and keeps manual input visible', async () => {
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/captcha-real.json', 'utf8'));
    const f = await fixture('user_login', '<form><div class="row"><input name="captcha"><img id="challenge"></div></form>', { captcha: sample.data });
    await f.page.waitForFunction(text => document.querySelector('[name=captcha]').value === text, sample.text);
    const unknown = sample.data.replace(/d="([^"]{450,})"/, (_, d) => 'd="' + d + ' '.repeat(10000) + '"');
    await f.page.locator('#challenge').evaluate((image, svg) => { image.src = 'data:image/svg+xml,' + encodeURIComponent(svg); }, unknown);
    await f.page.waitForFunction(() => document.querySelector('[name=captcha]').value === '');
    assert.equal(await f.page.locator('[name="captcha"]').isVisible(), true);
    assert.match(await f.page.locator('.exhloj-captcha-tools').innerText(), /未识别/);
    const records = await f.page.evaluate(() => JSON.parse(window.__store['exhloj.local.captcha.history']));
    assert.equal(records.length, 2); await f.done();
  });
  await check('captcha: independent module disable leaves challenge unchanged', async () => {
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/captcha-real.json', 'utf8'));
    const f = await fixture('user_login', '<form><div class="row"><input name="captcha"></div></form>', { captcha: sample.data }, { storage: { 'exhloj.coreui.settings.v1': JSON.stringify({ ui: false, captcha: false }) } });
    assert.equal(await f.page.locator('[name="captcha"]').inputValue(), '');
    assert.equal(await f.page.locator('.exhloj-captcha-tools').count(), 0); await f.done();
  });
  await check('remote: infers Luogu/CF/QOJ/AtCoder config without guessing local P IDs', async () => {
    for (const [subType, target, expected] of [['luogu', 'P1001', 'https://www.luogu.com.cn/problem/P1001'], ['codeforces', 'P1234A', 'https://codeforces.com/contest/1234/problem/A'], ['qoj', 'P123', 'https://qoj.ac/problem/123'], ['atcoder', 'atcoder/ABC123A', 'https://atcoder.jp/contests/abc123/tasks/abc123_a']]) {
      const f = await fixture('problem_detail', remoteBody, originContext(subType, target), { storage: noAuto });
      assert.equal(await f.page.locator(`#exhloj-local-remote a[href="${expected}"]`).count(), 1);
      assert.deepEqual(await f.page.evaluate(() => window.__gm), []); await f.done();
    }
    const f = await fixture('problem_detail', remoteBody, { pdoc: { docId: 1001, pid: 'P1001', content: 'Local', config: {} } });
    assert.equal(await f.page.locator('#exhloj-local-remote a').count(), 0);
    assert.match(await f.page.locator('#exhloj-local-remote').innerText(), /未识别/); await f.done();
  });
  await check('remote: current live Luogu HTML schema, statement copy and persistent metadata cache', async () => {
    const f = await fixture('problem_detail', remoteBody, originContext('luogu', 'P1001'), { remote: { [metaURL]: { text: fs.readFileSync('tests/fixtures/luogu-problem.response', 'utf8') } } });
    await f.page.waitForSelector('[data-exh-difficulty="1"]');
    await f.page.locator('[data-exh-action="remote-statement"]').click();
    await f.page.waitForSelector('.exhloj-remote-article h1');
    assert.match(await f.page.locator('.exhloj-remote-article h1').innerText(), /P1001 A\+B/);
    await f.page.locator('[data-exh-action="remote-copy-statement"]').click();
    assert.match((await f.page.evaluate(() => window.__clipboard))[0], /^# P1001/);
    assert.equal((await f.page.evaluate(() => window.__gm)).length, 1);
    const storage = await f.page.evaluate(() => window.__store); await f.done();
    const g = await fixture('problem_detail', remoteBody, originContext('luogu', 'P1001'), { storage });
    await g.page.waitForSelector('[data-exh-difficulty="1"]');
    assert.equal((await g.page.evaluate(() => window.__gm)).length, 0); await g.done();
  });
  await check('remote: official CF API rating remains usable when Luogu returns 401', async () => {
    const api = JSON.parse(fs.readFileSync('tests/fixtures/cf-problems.response', 'utf8'));
    const expected = api.result.problems.find(p => p.contestId === 1 && p.index === 'A').rating;
    const f = await fixture('problem_detail', remoteBody, originContext('codeforces', 'P1A'), { remote: {
      'https://www.luogu.com.cn/problem/CF1A': { status: 401, text: 'Login required' },
      'https://codeforces.com/api/problemset.problems': { json: api },
    } });
    await f.page.waitForSelector('[data-exh-cf-rating]');
    assert.equal(await f.page.locator('[data-exh-cf-rating]').innerText(), `CF *${expected}`);
    assert.match(await f.page.locator('.exhloj-remote-status').innerText(), /登录/);
    const requests = await f.page.evaluate(() => window.__gm);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(r => !JSON.stringify(r).includes('__token') && !JSON.stringify(r).includes('__uid')));
    assert.equal(requests.find(r => r.url.includes('codeforces.com/api')).anonymous, true); await f.done();
  });
  await check('remote: solutions paginate, sanitize HTML, preserve exact Markdown and export valid UTF-8 ZIP', async () => {
    const raw = '## First\n\n<script>window.pwned=1</script><img src="data:image/png;base64,iVBORw0KGgo=" onerror="window.pwned=2"><iframe srcdoc="bad"></iframe><a href="javascript:alert(1)">bad</a>\n\n[relative](/problem/P2)\n\n```cpp\n#include <bits/stdc++.h>\n```';
    const f = await fixture('problem_detail', remoteBody, originContext('luogu', 'P1001'), { storage: noAuto, remote: {
      [metaURL]: { json: sampleMeta },
      [solutionsURL(1)]: { json: { data: { solutions: { result: [{ lid: 'abc', author: { name: '<img>' }, content: raw }], count: 2 } } } },
      [solutionsURL(2)]: { json: { data: { solutions: { result: [{ lid: 'def', author: { name: 'User2' }, content: '# 第二篇\n\n$x^2$' }], count: 2 } } } },
    } });
    await f.page.locator('[data-exh-action="remote-solutions"]').click();
    await f.page.waitForSelector('.exhloj-remote-solutions');
    assert.equal(await f.page.locator('.exhloj-remote-solutions script,.exhloj-remote-solutions iframe,.exhloj-remote-solutions [onerror]').count(), 0);
    assert.equal(await f.page.evaluate(() => window.pwned), undefined);
    assert.equal(await f.page.locator('.exhloj-remote-solutions a').filter({ hasText: 'relative' }).getAttribute('href'), 'https://www.luogu.com.cn/problem/P2');
    await f.page.locator('[data-exh-action="remote-copy-solution"]').click();
    assert.deepEqual(await f.page.evaluate(() => window.__clipboard), [raw]);
    await f.page.locator('[data-exh-action="remote-more"]').click();
    await f.page.waitForFunction(() => document.querySelectorAll('.exhloj-remote-solutions .exhloj-remote-article').length === 2);
    assert.equal(await f.page.locator('[data-exh-action="remote-more"]').count(), 0);
    const waiting = f.page.waitForEvent('download'); await f.page.locator('[data-exh-action="remote-export"]').click();
    const download = await waiting; fs.copyFileSync(await download.path(), 'tests/output/remote-export.zip');
    fs.writeFileSync('tests/output/remote-export-expected.txt', raw); await f.done();
  });
  await check('remote: login errors leave controls retryable and do not create background request loops', async () => {
    const f = await fixture('problem_detail', remoteBody, originContext('luogu', 'P1001'), { storage: noAuto, remote: { [solutionsURL(1)]: { status: 401, text: 'Login' } } });
    await f.page.locator('[data-exh-action="remote-solutions"]').click();
    await f.page.waitForFunction(() => document.querySelector('#exhloj-local-toast')?.textContent.includes('登录'));
    await f.page.waitForTimeout(1000); assert.equal((await f.page.evaluate(() => window.__gm)).length, 1);
    await f.page.evaluate(url => { window.__remote[url] = { json: { data: { solutions: { result: [], count: 0 } } } }; }, solutionsURL(1));
    await f.page.locator('[data-exh-action="remote-solutions"]').click();
    await f.page.waitForSelector('.exhloj-remote-solutions'); assert.match(await f.page.locator('.exhloj-remote-solutions').innerText(), /0 篇/); await f.done();
  });
  await check('remote: local origin editing persists, imports legacy maps and preserves unrelated cache', async () => {
    const context = { domain: { _id: 'test' }, pdoc: { docId: 123, pid: 'P123', content: 'Local', config: {} } };
    const f = await fixture('problem_detail', remoteBody, context, { storage: { ...noAuto, 'exhloj.coreui.cache.v1': JSON.stringify({ 'exhloj.user': { keep: 1 } }) } });
    await f.page.locator('[data-exh-action="remote-config"]').click();
    await f.page.locator('#exhloj-origin-type').selectOption('codeforces');
    await f.page.locator('#exhloj-origin-target').fill('CF1234A');
    await f.page.locator('#exhloj-origin-difficulty').fill('6');
    await f.page.locator('[data-exh-action="remote-save-origin"]').click();
    await f.page.waitForSelector('[data-exh-difficulty="6"]');
    const cache = await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.cache.v1']));
    assert.deepEqual(cache['exhloj.user'], { keep: 1 }); assert.equal(cache['exhloj.remoteOrigins']['test/123'].target, 'CF1234A');
    const storage = await f.page.evaluate(() => window.__store); await f.done();
    const g = await fixture('problem_detail', remoteBody, context, { storage });
    assert.equal(await g.page.locator('a[href="https://codeforces.com/contest/1234/problem/A"]').count(), 1); await g.done();
    const h = await fixture('problem_detail', remoteBody, context, { storage: { ...noAuto, 'exhloj.coreui.cache.v1': JSON.stringify({ 'exhloj.problemOriginCache': { 'test/123': 'P1001' } }) } });
    assert.equal(await h.page.locator(`a[href="${metaURL}"]`).count(), 1); await h.done();
  });
  await check('remote: contest pages hide origin without fetching; explicit shortcut reveals it', async () => {
    const context = originContext('luogu', 'P1001');
    const f = await fixture('contest_detail_problem', remoteBody, context);
    assert.equal(await f.page.locator('#exhloj-local-remote a').count(), 0);
    assert.deepEqual(await f.page.evaluate(() => window.__gm), []); await f.done();
    const g = await fixture('contest_detail_problem', remoteBody, context, { storage: { 'exhloj.coreui.settings.v1': JSON.stringify({ remoteContest: 'shortcut', remoteAuto: false }) } });
    await g.page.keyboard.press('Control+q'); await g.page.waitForSelector(`#exhloj-local-remote a[href="${metaURL}"]`);
    await g.page.keyboard.press('Control+q'); assert.equal(await g.page.locator('#exhloj-local-remote a').count(), 0);
    assert.deepEqual(await g.page.evaluate(() => window.__gm), []); await g.done();
  });
  await check('remote: public CF/QOJ code is fetched only on click and inserted as text', async () => {
    for (const platform of ['codeforces', 'qoj']) {
      const url = platform === 'qoj' ? 'https://qoj.ac/submission/555' : 'https://codeforces.com/contest/1/submission/555';
      const snippet = '#include <iostream>\n// <script>window.sourcePwn=1</script>\nint main() {}';
      const encoded = snippet.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const context = { ...originContext(platform, platform === 'qoj' ? 'P123' : 'P1A'), rdoc: { lang: platform + '.cpp', code: '', judgeTexts: ['ID = 555'] } };
      const f = await fixture('record_detail', remoteBody, context, { remote: { [url]: { text: platform === 'qoj' ? `<div class="card-body"><pre><code>${encoded}</code></pre></div>` : `<pre id="program-source">${encoded}</pre>` } } });
      assert.equal((await f.page.evaluate(() => window.__gm)).length, 0);
      await f.page.locator('[data-exh-action="remote-code"]').click(); await f.page.waitForSelector('#exhloj-local-origin-code pre');
      assert.equal(await f.page.locator('#exhloj-local-origin-code pre').innerText(), snippet);
      assert.equal(await f.page.evaluate(() => window.sourcePwn), undefined); await f.done();
    }
  });
  await check('remote: late responses from an old route cannot alter the new problem', async () => {
    const f = await fixture('problem_detail', remoteBody, originContext('luogu', 'P1001'), { remote: { [metaURL]: { delay: 500, json: sampleMeta } } });
    await f.page.evaluate(() => {
      history.pushState({}, '', '/d/test/p/local');
      window.UiContext.pdoc = { docId: 999, pid: 'P999', content: 'Local', config: {} };
      document.body.append(document.createElement('p'));
    });
    await f.page.waitForTimeout(800);
    assert.equal(await f.page.locator('#exhloj-local-remote a').count(), 0);
    assert.equal(await f.page.locator('[data-exh-difficulty]').count(), 0);
    assert.match(await f.page.locator('#exhloj-local-remote').innerText(), /未识别/); await f.done();
  });

  await check('remote: local inline/display formulas render as MathML while code blocks remain literal', async () => {
    const formula = '行内 $\\frac{a+b}{2}$。\n\n$$\n\\sum_{i=1}^n i\n$$\n\n```cpp\nstring s="$x$";\n```';
    const f = await fixture('problem_detail', remoteBody, originContext('luogu', 'P1001'), { storage: noAuto,
      remote: { [solutionsURL(1)]: { json: { data: { solutions: { result: [{ lid: 'math', content: formula, author: { name: 'Math' } }], count: 1 } } } } } });
    await f.page.locator('[data-exh-action="remote-solutions"]').click();
    await f.page.waitForSelector('.exhloj-remote-solutions math');
    assert.equal(await f.page.locator('.exhloj-remote-solutions math').count(), 2);
    assert.equal(await f.page.locator('.exhloj-remote-solutions mfrac').count(), 1);
    assert.match(await f.page.locator('.exhloj-remote-solutions pre code').innerText(), /\$x\$/);
    const bounds = await f.page.locator('.exhloj-remote-solutions math').first().boundingBox();
    assert.ok(bounds.width > 10 && bounds.height > 10); await f.done();
  });
  await check('captcha collapse: Hydro textbox CSS, sibling SVG and full row fold/unfold', async () => {
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/captcha-real.json', 'utf8'));
    const body = `<style>.textbox{display:block!important}.login-captcha-row{display:flex!important}.captcha svg{display:block!important}</style>
      <form><div class="row"><input class="textbox" name="uname"></div><div class="row"><input class="textbox" name="password" type="password"></div>
      <div class="row login-captcha-row" style="display:flex!important"><div class="columns"><label>验证码<div class="textbox-container"><input class="textbox" name="captcha"></div></label></div><div class="columns"><div class="captcha">${sample.data}</div></div></div>
      <div class="row"><input name="rememberme" type="checkbox"><button type="submit">Login</button></div></form>`;
    const f = await fixture('user_login', body, { captcha: sample.data });
    await f.page.waitForFunction(text => document.querySelector('[name=captcha]').value === text, sample.text);
    assert.equal(await f.page.locator('.login-captcha-row').isVisible(), false, 'Entire captcha row must collapse');
    assert.equal(await f.page.locator('.captcha svg').isVisible(), false, 'SVG must not be visible through CSS overrides');
    assert.equal(await f.page.locator('[name=uname]').isVisible(), true);
    assert.equal(await f.page.locator('[name=password]').isVisible(), true);
    assert.equal(await f.page.locator('button[type=submit]').isVisible(), true);
    const toggle = f.page.locator('[data-exh-action=captcha-toggle]');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await f.page.locator('.login-captcha-row').isVisible(), true);
    assert.equal(await f.page.locator('.captcha svg').isVisible(), true);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await f.page.locator('.login-captcha-row').evaluate(node => node.style.getPropertyPriority('display')), 'important');
    assert.equal(await f.page.locator('[name=captcha]').inputValue(), sample.text);
    await toggle.click(); assert.equal(await f.page.locator('.login-captcha-row').isVisible(), false);
    await f.done();
  });
  await check('captcha collapse: mixed parent row preserves other controls and folds separate image widget', async () => {
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/captcha-real.json', 'utf8'));
    const body = `<style>.textbox{display:block!important}.captcha{display:flex!important}</style><form><div class="row all-fields">
      <label><input class="textbox" name="uname"></label><label><input class="textbox" name="password" type="password"></label>
      <label id="captcha-label">验证码<input class="textbox" name="captcha"></label><div class="captcha" id="separate-image">${sample.data}</div>
      <input name="rememberme" type="checkbox"><button type="submit">Login</button></div></form>`;
    const f = await fixture('user_login', body, { captcha: sample.data });
    await f.page.waitForFunction(text => document.querySelector('[name=captcha]').value === text, sample.text);
    assert.equal(await f.page.locator('.all-fields').isVisible(), true);
    assert.equal(await f.page.locator('#captcha-label').isVisible(), false);
    assert.equal(await f.page.locator('#separate-image').isVisible(), false);
    assert.equal(await f.page.locator('[name=password]').isVisible(), true);
    await f.page.locator('[data-exh-action=captcha-toggle]').click();
    assert.equal(await f.page.locator('#captcha-label').isVisible(), true);
    assert.equal(await f.page.locator('#separate-image').isVisible(), true);
    await f.done();
  });
  await check('captcha collapse: cloned captcha image keeps collapsed state and restores display on expansion', async () => {
    const sample = JSON.parse(fs.readFileSync('tests/fixtures/captcha-real.json', 'utf8'));
    const body = `<style>.captcha{display:flex!important}</style><form><div class="row"><input name="uname"><input name="password" type="password">
      <label>验证码<input name="captcha"></label><div class="captcha" id="replace-image" style="display:inline-flex!important">${sample.data}</div><button type="submit">Login</button></div></form>`;
    const f = await fixture('user_login', body, { captcha: sample.data });
    await f.page.waitForFunction(text => document.querySelector('[name=captcha]').value === text, sample.text);
    await f.page.locator('#replace-image').evaluate(node => node.replaceWith(node.cloneNode(true)));
    await f.page.waitForTimeout(350);
    assert.equal(await f.page.locator('#replace-image').isVisible(), false);
    await f.page.locator('[data-exh-action=captcha-toggle]').click();
    assert.equal(await f.page.locator('#replace-image').isVisible(), true);
    assert.equal(await f.page.locator('#replace-image').evaluate(node => node.style.getPropertyValue('display')), 'inline-flex');
    assert.equal(await f.page.locator('#replace-image').evaluate(node => node.style.getPropertyPriority('display')), 'important');
    assert.equal(await f.page.locator('[data-exh-action=captcha-toggle]').count(), 1); await f.done();
  });
  const tid = '67a000000000000000000001', tid2 = '67a000000000000000000002';
  const fast = extra => ({ 'exhloj.coreui.settings.v1': { helperDelay: 100, ...extra } });
  const oid = (days, suffix = 1) => Math.floor((Date.now() - days * 86400000) / 1000).toString(16).padStart(8, '0') + suffix.toString(16).padStart(16, '0');
  const tdoc = { docId: tid, title: 'Fixture "Contest"', pids: [1, 2], beginAt: new Date(Date.now() - 3600000).toISOString(), endAt: new Date(Date.now() + 3600000).toISOString(), rule: 'oi' };
  async function openWork(f, action) { await f.page.locator('[data-exh-fallback]').click(); await f.page.locator(`#exhloj-local-dialog [data-exh-action="${action}"]`).click(); }
  async function downloaded(f, action) { const pending = f.page.waitForEvent('download'); await f.page.locator(`[data-exh-action="${action}"]`).click(); return fs.readFileSync(await (await pending).path()); }
  async function finished(f, kind) { await f.page.waitForFunction(kind => /^(已完成|完成|未完成|已取消)/.test(document.querySelector(`[data-work-progress="${kind}"]`)?.textContent), kind); }
  async function juanJSON(f) { return JSON.parse((await downloaded(f, 'juan-json')).toString()); }

  await check('work: branding, module switches, menu deduplication and default no background requests', async () => {
    assert.match(script, /\/\/ @name\s+Extend HLOJ\n/); assert.match(script, /\/\/ @version\s+2\.3\.1/);
    const f = await fixture('contest_detail', '<ol id="menu-nav-user"></ol>', { tdoc }, { path: `/d/test/contest/${tid}`, storage: fast() });
    await f.page.waitForTimeout(500);
    assert.equal(f.requests.length, 1); assert.equal(await f.page.locator('[data-exh-work-menu]').count(), 3);
    assert.equal(await f.page.locator('#exhloj-contest-tools').count(), 1);
    await f.page.addScriptTag({ content: script }); assert.equal(await f.page.locator('[data-exh-work-menu]').count(), 3);
    await f.done();
    const g = await fixture('contest_detail', '<ol id="menu-nav-user"></ol>', { tdoc }, { storage: fast({ contestHelper: false, juanMonitor: false, userModule: false }) });
    assert.equal(await g.page.locator('[data-exh-work-menu]').count(), 0); assert.equal(await g.page.locator('#exhloj-contest-tools').count(), 0); await g.done();
  });
  await check('work: statement ZIP, Unicode and binary attachments, multilingual content, public contest files', async () => {
    const external = 'https://attachments.example.test/signed?a=1';
    const api = req => {
      const u = new URL(req.url());
      if (u.pathname === '/d/test/p/1') return { body: { pdoc: { title: '中文 A', content: JSON.stringify({ zh: '![图](file://%E5%9B%BE.bin)\n[样例](file://sample.in)', en: 'English' }), config: { timeMax: 1000, memoryMax: 256 }, additional_file: [{ name: '图.bin' }, { name: 'sample.in' }] } } };
      if (u.pathname === '/d/test/p/2') return { body: { pdoc: { title: 'B', content: 'Second statement' } } };
      if (u.pathname === '/d/test/p/1/files') { assert.deepEqual(JSON.parse(req.postData()), { operation: 'get_links', type: 'additional_file', files: ['图.bin', 'sample.in'] }); return { body: { links: { '图.bin': external, 'sample.in': '/files/sample.in' } } }; }
      if (u.href === external) return { bytes: [0, 255, 128, 13, 10], headers: { 'Access-Control-Allow-Origin': '*' } };
      if (u.pathname === '/files/sample.in') return { text: '1 2\n', contentType: 'application/octet-stream' };
      if (u.pathname.endsWith('/file/public/global.txt')) return { text: 'global\n', contentType: 'application/octet-stream' };
    };
    const f = await fixture('contest_detail', '', { tdoc: { ...tdoc, files: [{ name: 'global.txt' }] } }, { path: `/d/test/contest/${tid}`, storage: fast(), api, strictApi: true, attachments: [external] });
    await openWork(f, 'contest-helper'); fs.writeFileSync('tests/output/contest-export.zip', await downloaded(f, 'contest-statements')); await finished(f, 'contest');
    assert.equal(await f.page.locator('[data-work-errors="contest"]').textContent(), '');
    assert.equal(f.requests.find(r => r.url === external).headers.cookie, undefined); await f.done();
  });
  await check('work: partial statement export records denied problems and failed attachments explicitly', async () => {
    const f = await fixture('contest_detail', '', { tdoc }, { path: `/d/test/contest/${tid}`, storage: fast(), strictApi: true, api: {
      'GET /d/test/p/1': { body: { pdoc: { title: 'A', content: '[missing](file://missing.in)' } } },
      'POST /d/test/p/1/files': { body: { links: {} } }, 'GET /d/test/p/2': { status: 403, body: { error: 'Forbidden' } }
    } });
    await openWork(f, 'contest-helper'); fs.writeFileSync('tests/output/contest-partial.zip', await downloaded(f, 'contest-statements')); await finished(f, 'contest');
    assert.match(await f.page.locator('[data-work-errors="contest"]').textContent(), /missing.in/); await f.done();
  });
  await check('work: paginated record JSON, CSV escaping, Ghost chronology and optional record details', async () => {
    const first = oid(0.03), second = oid(0.02), rdocs = [ { _id: second, uid: 2, pid: 2, score: 70, status: 2, code: 'secret source' }, { _id: first, uid: 1, pid: 1, score: 100, status: 1, code: 'secret' } ];
    const api = req => {
      const u = new URL(req.url());
      if (u.pathname === '/d/test/record') return { body: { rdocs: u.searchParams.get('page') === '1' ? rdocs : [rdocs[1]], pageCount: 2, udict: { 1: { uname: '=SUM(1,2)' }, 2: { uname: 'A,"B' } } } };
      if (u.pathname.startsWith('/d/test/record/')) return { body: { rdoc: { testCases: [{ status: 1, time: 50, memory: 1024 }, { status: 2, time: 80, memory: 2048 }, { status: 0, time: 0 }] } } };
    };
    const f = await fixture('contest_detail', '', { tdoc, pdict: { 1: { title: 'A' }, 2: { title: 'B' } } }, { path: `/d/test/contest/${tid}`, storage: fast(), api, strictApi: true });
    await openWork(f, 'contest-helper');
    const data = JSON.parse((await downloaded(f, 'contest-records-json')).toString()); await finished(f, 'contest');
    assert.equal(data.records.length, 2); assert.equal(data.records[0].rid, first); assert.equal(data.records[0].codeSize, 6); assert.ok(!JSON.stringify(data).includes('secret'));
    const csv = (await downloaded(f, 'contest-records-csv')).toString(); await finished(f, 'contest'); assert.ok(csv.includes('"\'=SUM(1,2)"')); assert.ok(csv.includes('"A,""B"'));
    const ghost = (await downloaded(f, 'contest-ghost')).toString(); await finished(f, 'contest'); assert.ok(ghost.includes('@contlen 120')); assert.ok(ghost.includes('@submissions 2')); assert.match(ghost, /@s 1,A,0,\d+,AC,100/); assert.match(ghost, /@s 2,B,0,\d+,RJ,70/);
    await f.page.locator('[name="details"]').check(); const detailed = JSON.parse((await downloaded(f, 'contest-records-json')).toString()); await finished(f, 'contest');
    assert.equal(detailed.records[0].maxTime, 80); assert.equal(detailed.records[0].maxMemory, 2048); assert.equal(detailed.records[0].judgedCases, 2); await f.done();
  });
  await check('work: monitor deduplicates sources, handles normalized weighted scores, recent times and snapshot increments', async () => {
    let added = false;
    const recent = oid(0.1), old = oid(30), later = oid(0.02), uname = '<img src=x onerror="window.injected=1">';
    const col = pid => ({ type: 'problem', raw: pid, value: String(pid) }), user = (id, name) => ({ type: 'user', raw: id, value: name }), score = (n, rid, value = n) => ({ type: 'record', score: n, raw: rid, value: String(value), style: 'background:green' });
    const api = req => {
      const u = new URL(req.url()), p = u.pathname;
      if (p === '/d/test/record') return { body: { rdocs: [{ _id: recent, uid: 1, pid: 1, status: 1 }, { _id: later, uid: 1, pid: 1, status: 1 }, { _id: old, uid: 2, pid: 3, status: 1 }, { _id: oid(0.1, 2), uid: 1, pid: 99, status: 2 }, ...(added ? [{ _id: later, uid: 1, pid: 6, status: 1 }] : [])], pageCount: 1, udict: { 1: { uname }, 2: { uname: 'Bob' } } } };
      if (p === '/d/test/contest' || p === '/d/test/homework') return { body: { tdocs: [{ docId: p.endsWith('contest') ? tid : tid2 }], pageCount: 1 } };
      if (p.includes('/contest/') && p.endsWith('/scoreboard')) return { body: { tdoc: { rule: 'oi', pids: [1, 2, 4], score: { 1: 50, 2: 100, 4: 60 } }, udict: { 1: { uname }, 2: { uname: 'Bob' } }, rows: [ [{ type: 'rank' }, user(0, 'User'), col(1), col(2), col(4)], [{}, user(1, 'A'), score(100, recent, 50), score(70, recent), score(100, recent, 60)], [{}, user(2, 'Bob'), {}, { type: 'records', raw: [score(30, old), score(100, recent)] }, {}] ] } };
      if (p.includes('/homework/') && p.endsWith('/scoreboard')) return { body: { tdoc: { rule: 'oi', pids: [3, 4, 5] }, udict: { 1: { uname }, 2: { uname: 'Bob' } }, rows: [ [user(0, 'User'), col(3), col(4), col(5)], [user(1, 'A'), {}, score(100, recent), score(100, '')], [user(2, 'Bob'), score(100, old), {}, {}] ] } };
    };
    const f = await fixture('homepage', '', {}, { storage: fast(), api, strictApi: true }); await openWork(f, 'juan-open');
    await f.page.locator('[data-exh-action="juan-start"]').click(); await finished(f, 'juan');
    let result = await juanJSON(f); assert.equal(result.complete, true); assert.equal(result.unknownTime, 1);
    assert.deepEqual(result.rows.map(r => [r.uid, r.total, r.recent, r.added]), [[1, 3, 2, null], [2, 2, 1, null]]); assert.equal(await f.page.evaluate(() => window.injected), undefined);
    added = true; await f.page.locator('[data-exh-action="juan-start"]').click(); await finished(f, 'juan'); result = await juanJSON(f);
    assert.deepEqual(result.rows.map(r => [r.uid, r.total, r.recent, r.added]), [[1, 4, 3, 1], [2, 2, 1, 0]]); assert.ok(result.baseline);
    const snapshots = await f.page.evaluate(() => JSON.parse(window.__store['exhloj.local.juan.snapshots.v1'])); assert.equal(Object.values(snapshots)[0].history.length, 2);
    await f.page.locator('[data-exh-action="juan-copy"]').click(); assert.match((await f.page.evaluate(() => window.__clipboard)).at(-1), /区间 3，累计 4，新增 1/); await f.done();
  });
  await check('work: page limits and denied scoreboards retain partial results without writing a snapshot', async () => {
    const f = await fixture('homepage', '', {}, { storage: fast({ helperPageLimit: 1 }), strictApi: true, api: {
      'GET /d/test/record': { body: { rdocs: [{ _id: oid(0.1), uid: 1, pid: 1, status: 1 }] } },
      'GET /d/test/contest': { body: { tdocs: [{ docId: tid }], pageCount: 1 } },
      [`GET /d/test/contest/${tid}/scoreboard`]: { status: 403 }, 'GET /d/test/homework': { body: { tdocs: [] } }
    } }); await openWork(f, 'juan-open'); await f.page.locator('[data-exh-action="juan-start"]').click(); await finished(f, 'juan');
    const result = await juanJSON(f); assert.equal(result.complete, false); assert.equal(result.rows[0].total, 1); assert.equal(result.errors.length, 2);
    assert.equal(await f.page.evaluate(() => window.__store['exhloj.local.juan.snapshots.v1']), undefined); await f.done();
  });
  await check('work: monitor cancellation aborts paging and does not save a complete snapshot', async () => {
    const f = await fixture('homepage', '', {}, { storage: fast(), strictApi: true, api: { 'GET /d/test/record': { delay: 2000, body: { rdocs: [{ _id: oid(0.1), uid: 1, pid: 1, status: 1 }] } } } });
    await openWork(f, 'juan-open'); await f.page.locator('[data-exh-action="juan-start"]').click(); await f.page.waitForFunction(() => document.querySelector('[data-work-progress="juan"]').textContent.includes('/record'));
    await f.page.locator('[data-exh-action="work-cancel"][data-kind="juan"]').click(); await finished(f, 'juan');
    assert.match(await f.page.locator('[data-work-progress="juan"]').textContent(), /^已取消/); assert.equal((await juanJSON(f)).complete, false);
    assert.equal(await f.page.evaluate(() => window.__store['exhloj.local.juan.snapshots.v1']), undefined); assert.equal(f.requests.filter(r => r.kind === 'fetch').length, 1); await f.done();
  });
  await check('work: registration preview filters targets, manual POST only on click, and attendance cache', async () => {
    const ended = '67a000000000000000000003', enrolled = '67a000000000000000000004', other = '67a000000000000000000005';
    const docs = [{ ...tdoc, title: 'Weekly Round' }, { ...tdoc, docId: tid2, title: 'Other Round' }, { ...tdoc, docId: ended, endAt: '2020-01-01', title: 'Weekly Old' }, { ...tdoc, docId: enrolled, title: 'Weekly Enrolled' }, { ...tdoc, docId: other, title: 'Weekly ACM', rule: 'acm' }];
    const f = await fixture('homepage', '', {}, { storage: fast({ autoAttendTargets: 'test/contest', autoAttendTitle: 'Weekly', autoAttendRules: 'oi' }), strictApi: true, api: req => {
      const u = new URL(req.url());
      if (u.pathname === '/d/test/contest') return { body: { tdocs: docs, pageCount: 1, tsdict: { [enrolled]: { attend: 1 } } } };
      if (u.pathname === `/d/test/contest/${tid}`) { if (req.method() === 'POST') { assert.equal(JSON.parse(req.postData()).operation, 'attend'); return { body: {} }; } return { body: { tdoc: { ...tdoc, owner: 99 }, tsdoc: {} } }; }
    } }); await openWork(f, 'contest-helper'); await f.page.locator('[data-exh-action="attend-preview"]').click(); await finished(f, 'auto');
    assert.equal(await f.page.locator('[data-exh-action="attend-one"]').count(), 1); assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
    await f.page.locator('[data-exh-action="attend-one"]').click(); await finished(f, 'auto'); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
    await f.page.locator('[data-exh-action="attend-preview"]').click(); await finished(f, 'auto'); assert.equal(await f.page.locator('[data-exh-action="attend-one"]').count(), 0); await f.done();
  });
  await check('work: explicitly enabled automatic registration runs with configured target only', async () => {
    const f = await fixture('homepage', '', {}, { storage: fast({ autoAttend: true, autoAttendTargets: 'test/contest', autoAttendInterval: 10 }), strictApi: true, api: {
      'GET /d/test/contest': { body: { tdocs: [tdoc], pageCount: 1 } }, [`GET /d/test/contest/${tid}`]: { body: { tdoc: { ...tdoc, owner: 99 } } }, [`POST /d/test/contest/${tid}`]: { body: {} }
    } });
    await f.page.waitForFunction(() => !!window.__store['exhloj.local.attended.v1']); assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
    assert.ok(f.requests.every(r => new URL(r.url).pathname.startsWith('/d/test/'))); await f.done();
  });
  await check('work: accessible domains picker, monitor selections persist when saving main settings', async () => {
    const f = await fixture('homepage', '', {}, { storage: fast(), strictApi: true, api: { 'GET /home/domain': { body: { ddocs: [{ _id: 'test', name: 'Test' }, { _id: 'extra', name: 'Extra' }] } }, 'GET /d/extra/record': { body: { rdocs: [] } } } });
    await openWork(f, 'juan-open'); await f.page.locator('[data-exh-action="juan-domains"]').click(); await f.page.locator('[data-juan-domain="test"]').uncheck(); await f.page.locator('[data-juan-domain="extra"]').check();
    assert.equal(await f.page.locator('[name="domains"]').inputValue(), 'extra'); await f.page.locator('[name="contests"]').uncheck(); await f.page.locator('[name="homeworks"]').uncheck();
    await f.page.locator('[data-exh-action="juan-start"]').click(); await finished(f, 'juan'); await f.page.locator('[data-exh-action="close"]').click(); await f.page.locator('[data-exh-fallback]').click(); await f.page.locator('[data-exh-action="save-settings"]').click();
    const settings = await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.settings.v1'])); assert.equal(settings.juanDomains, 'extra'); assert.equal(settings.juanContests, false); assert.equal(settings.juanHomeworks, false); await f.done();
  });
  await check('work: repeated pages and request budgets stop scanning, retaining partial evidence', async () => {
    for (const mode of ['repeat', 'budget']) {
      const f = await fixture('homepage', '', {}, { storage: fast({ helperRequestLimit: 10, juanContests: false, juanHomeworks: false }), strictApi: true, api: req => {
        const u = new URL(req.url()), pageNo = Number(u.searchParams.get('page'));
        if (u.pathname === '/d/test/record') return { body: { rdocs: [{ _id: oid(0.1, mode === 'repeat' ? 1 : pageNo), uid: 1, pid: mode === 'repeat' ? 1 : pageNo, status: 1 }] } };
      } });
      await openWork(f, 'juan-open'); await f.page.locator('[data-exh-action="juan-start"]').click(); await finished(f, 'juan');
      const result = await juanJSON(f); assert.equal(result.complete, false); assert.equal(result.rows[0].total, mode === 'repeat' ? 1 : 10);
      assert.equal(f.requests.filter(r => r.kind === 'fetch').length, mode === 'repeat' ? 2 : 10);
      assert.equal(await f.page.evaluate(() => window.__store['exhloj.local.juan.snapshots.v1']), undefined); await f.done();
    }
  });
  const userSample = { oiers: { 7: { name: '七号', uname: 'seven', oierId: 1234, level: 6, grade: 2029, records: [{ contest: 'NOIP 2026', awards: '一等奖', score: 300 }] }, 8: { name: '八号', uname: 'eight', records: [] } }, teachers: [7], practice: { 7: 123 } };
  const ratingSample = { contests: [[`test/${tid}`, 'Round 1', 1], [`test/${tid2}`, 'Round 2', 1]], records: [[7, 0, 1, 1900, 2100], [8, 0, 2, 1700, 1600], [7, 1, 2, 1800, 1700], [8, 1, 1, 1800, 2000], [9, 1, 1, 1800, 2000]], commands: '# sample' };
  const userStorage = (options = {}, users = userSample, ratings = ratingSample) => ({ ...fast(options), 'exhloj.coreui.cache.v1': { 'exhloj.user': users, 'exhloj.ratedcontests': ratings, 'exhloj.problemOriginCache': { keep: true } } });
  async function userData(f) { return JSON.parse((await downloaded(f, 'user-export')).toString()); }
  async function openEditor(f, uid) { await openWork(f, 'user-open'); await f.page.locator('#exhloj-user-id').fill(String(uid)); await f.page.locator('#exhloj-local-dialog [data-exh-action="user-edit"]').click(); }

  await check('user: ordinary and signed-out users can edit any local UID with no OJ writes', async () => {
    for (const userId of [42, 0]) {
      const f = await fixture('homepage', '', {}, { userId, storage: userStorage() }); await openEditor(f, 876);
      await f.page.locator('[name="name"]').fill('<img src=x onerror="window.injected=1">'); await f.page.locator('[name="uname"]').fill('local-user'); await f.page.locator('[name="teacher"]').check(); await f.page.locator('[name="level"]').fill('8');
      await f.page.locator('[name="awards"]').fill(JSON.stringify([{ contest: '<script>evil()</script>', awards: '金牌', score: 100 }])); await f.page.locator('[data-exh-action="user-save"]').click();
      let cache = await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.cache.v1'])); assert.equal(cache['exhloj.user'].oiers[876].uname, 'local-user'); assert.ok(cache['exhloj.user'].teachers.includes(876)); assert.equal(cache['exhloj.problemOriginCache'].keep, true);
      assert.equal(f.requests.length, 1); assert.deepEqual(await f.page.evaluate(() => window.__gm), []); assert.equal(await f.page.evaluate(() => window.injected), undefined);
      await f.page.locator('[data-exh-action="user-clear"]').click(); cache = await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.cache.v1'])); assert.equal(cache['exhloj.user'].oiers[876], undefined); assert.ok(!cache['exhloj.user'].teachers.includes(876)); await f.done();
    }
    assert.ok(!/isAdmin|===\s*(?:46|151)\b/.test(script));
  });
  await check('user: profile info, prizes, OIerDB, default rating and late profile context', async () => {
    const f = await fixture('user_detail', '<a class="user-profile-name" href="/user/7">七号 (seven)</a>', { udoc: { _id: 7, uname: 'seven' } }, { storage: userStorage(), path: '/user/7' });
    const card = f.page.locator('#exhloj-local-user-card'); assert.equal(await card.count(), 1); assert.match(await card.textContent(), /用户信息 · 本地资料/); assert.match(await card.textContent(), /NOIP 2026/); assert.match(await card.textContent(), /🥇 一等奖（300 分）/);
    assert.equal(await card.locator('a[href="https://oier.baoshuo.dev/oier/1234"]').count(), 1); assert.equal(await card.locator('.exhloj-user-rating').textContent(), '1800');
    await card.locator('[data-exh-action="user-history"]').click(); assert.match(await f.page.locator('#exhloj-local-dialog').textContent(), /最高 1900/); assert.equal(await f.page.locator('#exhloj-local-dialog tr').count(), 3); assert.equal(f.requests.length, 1); await f.done();
    const g = await fixture('user_detail', '', {}, { path: '/user/99' }); assert.equal(await g.page.locator('#exhloj-local-user-card').count(), 1); assert.equal(await g.page.locator('#exhloj-local-user-card .exhloj-user-rating').textContent(), '1800');
    await g.page.evaluate(() => { window.UiContext.udoc = { _id: 99, uname: 'new-user' }; document.body.append(document.createElement('div')); }); await g.page.waitForTimeout(250); assert.equal(await g.page.locator('#exhloj-local-user-card').count(), 1); await g.done();
  });
  await check('user: seven display modes, independent CCF badges, dynamic names and exact disable restoration', async () => {
    const f = await fixture('homepage', '<a id="named" class="user-profile-name" href="/user/7"><em>旧姓名</em> (old)</a>', { udict: { 7: { uname: 'oj-seven' } } }, { storage: userStorage() }); await openWork(f, 'user-open');
    const modes = [['no-change', '旧姓名 (old)'], ['display-realname', '七号'], ['display-realname-color', '七号'], ['display-username', 'seven'], ['display-username-color', 'seven'], ['display-username-realname', '七号 (seven)'], ['display-username-realname-color', '七号 (seven)']];
    for (const [mode, expected] of modes) { await f.page.locator('[name="display"]').selectOption(mode); await f.page.locator('[data-exh-action="user-options-save"]').click(); assert.equal(await f.page.locator('#named').textContent(), expected); assert.equal(await f.page.locator('#named').evaluate(node => node.classList.contains('exhloj-user-level-teacher')), mode.endsWith('-color')); }
    await f.page.locator('[name="display"]').selectOption('no-change'); await f.page.locator('[name="ccf"]').check(); await f.page.locator('[data-exh-action="user-options-save"]').click(); assert.equal(await f.page.locator('#named .exhloj-user-ccf').count(), 1);
    await f.page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="col--submit-by"><a id="late-user" href="/user/7">seven</a></div>')); await f.page.waitForSelector('#late-user .exhloj-user-ccf');
    await f.page.evaluate(() => document.querySelector('#late-user').textContent = 'changed'); await f.page.waitForTimeout(300); assert.equal(await f.page.locator('#late-user .exhloj-user-ccf').count(), 1);
    await f.page.locator('[data-exh-action="close"]').click(); await f.page.locator('[data-exh-fallback]').click(); await f.page.locator('[name="userModule"]').uncheck(); await f.page.locator('[data-exh-action="save-settings"]').click();
    assert.equal(await f.page.locator('#named').innerHTML(), '<em>旧姓名</em> (old)'); assert.equal(await f.page.locator('.exhloj-user-ccf').count(), 0); assert.equal(await f.page.locator('#named.exhloj-user-name').count(), 0); await f.done();
  });
  await check('user: JSON import/export round trip, legacy arrays, unknown sensitive keys excluded and invalid import atomic', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage() }); await openWork(f, 'user-open'); const exported = await userData(f); assert.equal(exported.format, 'exhloj-user'); assert.equal(exported.ratings.records.length, 5);
    await f.page.locator('[data-exh-action="user-json"]').click(); await f.page.locator('#exhloj-user-json').fill(JSON.stringify({ ...exported, users: { ...exported.users, token: 'do-not-copy' } })); await f.page.locator('[data-exh-action="user-json-save"]').click();
    const before = await f.page.evaluate(() => window.__store['exhloj.coreui.cache.v1']); assert.ok(!before.includes('do-not-copy'));
    await f.page.locator('#exhloj-user-json').fill(JSON.stringify({ ...exported, ratings: { contests: [], records: [[7, 99, 1, 2000, 2000]] } })); await f.page.locator('[data-exh-action="user-json-save"]').click(); assert.equal(await f.page.evaluate(() => window.__store['exhloj.coreui.cache.v1']), before);
    await f.page.locator('#exhloj-user-json').fill(JSON.stringify({ 'exhloj.user': { oiers: [null, { name: '一号', records: [] }], teachers: [1], practice: {} } })); await f.page.locator('[data-exh-action="user-json-save"]').click();
    const after = await userData(f); assert.equal(after.users.oiers[1].name, '一号'); assert.equal(after.ratings.records.length, 5); await f.done();
  });
  await check('user: ranking modes, rating ties, local scoreboard columns and dynamic row deduplication', async () => {
    const body = '<div class="section__table-container"><table class="data-table"><colgroup><col class="col--rank"><col class="col--user"><col class="col--total_score"></colgroup><thead><tr><th>#</th><th>User</th><th class="col--total_score">Score</th></tr></thead><tbody><tr><td>1</td><td class="col--user"><a href="/user/7">seven</a></td><td class="col--total_score">100</td></tr><tr><td>2</td><td class="col--user"><a href="/user/8">eight</a></td><td class="col--total_score">0</td></tr></tbody></table></div>';
    const f = await fixture('contest_scoreboard', body, {}, { storage: userStorage(), path: `/d/test/contest/${tid}` });
    assert.equal(await f.page.locator('thead [data-exh-user-column]').count(), 2); assert.equal(await f.page.locator('tbody [data-exh-user-column]').count(), 4); assert.match(await f.page.locator('tbody tr').first().textContent(), /\+100 = 1900/);
    await f.page.evaluate(() => { const row = document.querySelector('tbody tr').cloneNode(true); row.querySelector('.col--user a').href = '/user/8'; row.querySelector('.col--user a').textContent = 'eight'; document.querySelector('tbody').append(row); }); await f.page.waitForTimeout(250); assert.equal(await f.page.locator('thead [data-exh-user-column]').count(), 2); assert.match(await f.page.locator('tbody tr').last().textContent(), /−100 = 1700/);
    await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-ranking"]').click(); assert.equal(await f.page.locator('#exhloj-local-dialog tr').count(), 4); assert.deepEqual(await f.page.locator('#exhloj-local-dialog tr td:first-child').allTextContents(), ['1', '1', '1']);
    await f.page.locator('[data-exh-action="user-ranking"][data-mode="max"]').click(); assert.deepEqual(await f.page.locator('#exhloj-local-dialog tr td:first-child').allTextContents(), ['1', '2', '2']);
    await f.page.locator('[data-exh-action="user-ranking"][data-mode="up"]').click(); assert.match(await f.page.locator('#exhloj-local-dialog').textContent(), /近 20 场/); assert.equal(f.requests.length, 1); await f.done();
  });
  await check('user: local Rating calculation matches a two-player reference and remains available when signed out', async () => {
    const f = await fixture('homepage', '', {}, { userId: 0, storage: userStorage({}, {}, {}) }); await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-rated"]').click();
    const commands = `version:2\ncontest:test/${tid},Round,1,[[7,1],[8,2]]\nrating:test/${tid}`; await f.page.locator('#exhloj-user-commands').fill(commands); await f.page.locator('[data-exh-action="user-calculate"]').click(); await finished(f, 'user');
    const data = await userData(f); assert.deepEqual(data.ratings.records.map(row => [row[0], row[3]]), [[7, 1898], [8, 1704]]); assert.equal(data.ratings.commands, commands); assert.equal(f.requests.length, 1);
    const before = await f.page.evaluate(() => window.__store['exhloj.coreui.cache.v1']); await f.page.locator('#exhloj-user-commands').fill(commands + `\nrating:test/${tid}`); await f.page.locator('[data-exh-action="user-calculate"]').click(); assert.equal(await f.page.evaluate(() => window.__store['exhloj.coreui.cache.v1']), before); await f.done();
  });
  await check('user: explicit scoreboard reads, v1/v2 eligibility, zero weights and atomic denied-board failures', async () => {
    const header = [{ type: 'rank', value: '#' }, { type: 'user', value: 'User' }, { type: 'problem', raw: 1 }];
    const board = { rows: [header, [{ type: 'rank', value: '1' }, { type: 'user', raw: 7 }, { type: 'record', score: 100, raw: oid(0.1) }], [{ type: 'rank', value: '2' }, { type: 'user', raw: 8 }, { type: 'record', score: 0, raw: oid(0.1, 2) }]], tdoc: { rule: 'oi' } };
    const f = await fixture('homepage', '', {}, { storage: userStorage({}, {}, {}), strictApi: true, api: { [`GET /d/test/contest/${tid}/scoreboard`]: { body: board }, [`GET /d/test/contest/${tid2}/scoreboard`]: { status: 403 } } });
    assert.equal(f.requests.length, 1); await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-rated"]').click();
    for (const version of [1, 2]) { await f.page.locator('#exhloj-user-commands').fill(`version:${version}\ncontest:test/${tid},Round,0\nrating:test/${tid}`); await f.page.locator('[data-exh-action="user-calculate"]').click(); await finished(f, 'user'); const data = await userData(f); assert.equal(data.ratings.records.length, version); assert.ok(data.ratings.records.every(row => row[3] === 1800)); }
    const before = await f.page.evaluate(() => window.__store['exhloj.coreui.cache.v1']); await f.page.locator('#exhloj-user-commands').fill(`contest:test/${tid2},Denied,1\nrating:test/${tid2}`); await f.page.locator('[data-exh-action="user-calculate"]').click(); await finished(f, 'user'); assert.match(await f.page.locator('[data-work-errors="user"]').textContent(), /403/); assert.equal(await f.page.evaluate(() => window.__store['exhloj.coreui.cache.v1']), before);
    assert.ok(f.requests.every(r => r.method === 'GET')); await f.done();
  });
  await check('user: parallel contests select each users best weighted result and preserve local profile edits', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage({}, userSample, {}) }); await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-rated"]').click();
    const commands = `contest:test/${tid},A,1,[[7-1]-[8-2]]\ncontest:test/${tid2},B,1,[[7,2],[8,1]]\nrating:test/${tid},test/${tid2}`;
    await f.page.locator('#exhloj-user-commands').fill(commands); await f.page.locator('[data-exh-action="user-calculate"]').click(); await finished(f, 'user'); const data = await userData(f);
    assert.deepEqual(data.ratings.records.map(row => [row[0], row[1], row[3]]), [[7, 0, 1801], [8, 1, 1801]]); assert.equal(data.users.oiers[7].name, '七号'); await f.done();
  });
  await check('user: canceling a delayed calculation preserves previous ratings and allows retry', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage(), strictApi: true, api: { [`GET /d/test/contest/${tid}/scoreboard`]: { delay: 2000, body: { rows: [] } } } }); await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-rated"]').click(); const before = await userData(f);
    await f.page.locator('#exhloj-user-commands').fill(`contest:test/${tid},A,1\nrating:test/${tid}`); await f.page.locator('[data-exh-action="user-calculate"]').click(); await f.page.waitForFunction(() => document.querySelector('[data-work-progress="user"]').textContent.includes('/scoreboard'));
    await f.page.locator('[data-exh-action="work-cancel"][data-kind="user"]').click(); await finished(f, 'user'); assert.match(await f.page.locator('[data-work-progress="user"]').textContent(), /^已取消/); assert.deepEqual(await userData(f), before);
    await f.page.locator('#exhloj-user-commands').fill(`contest:test/${tid},A,1,[[7,1]]\nrating:test/${tid}`); await f.page.locator('[data-exh-action="user-calculate"]').click(); await finished(f, 'user'); assert.equal((await userData(f)).ratings.records[0][3], 1801); await f.done();
  });
  await check('user: explicit OJ name lookup is read-only and full backups retain user data and settings', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage(), strictApi: true, api: { 'GET /user/7': { body: { udoc: { _id: 7, uname: 'server-name', displayName: 'server-display' } } } } }); await openEditor(f, 7);
    await f.page.locator('[data-exh-action="user-fetch-name"]').click(); await f.page.waitForFunction(() => document.querySelector('[name="uname"]').value === 'server-name');
    assert.equal(await f.page.evaluate(() => window.__store['exhloj.coreui.cache.v1']['exhloj.user'].oiers[7].uname), 'seven'); await f.page.locator('[data-exh-action="user-save"]').click();
    await f.page.locator('[data-exh-action="close"]').click(); await f.page.locator('[data-exh-fallback]').click(); const backup = JSON.parse((await downloaded(f, 'export')).toString()); assert.equal(backup.cache['exhloj.user'].oiers[7].uname, 'server-name'); assert.equal(backup.cache['exhloj.ratedcontests'].records.length, 5); assert.equal(backup.settings.userModule, true); assert.ok(f.requests.every(r => r.method === 'GET')); await f.done();
  });
  await check('user: complete monitor results can explicitly update local practice points', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage({ juanContests: false, juanHomeworks: false }), strictApi: true, api: { 'GET /d/test/record': { body: { rdocs: [{ _id: oid(0.1), uid: 7, pid: 1, status: 1 }, { _id: oid(0.1, 2), uid: 7, pid: 2, status: 1 }], pageCount: 1 } } } });
    await openWork(f, 'juan-open'); await f.page.locator('[data-exh-action="juan-start"]').click(); await finished(f, 'juan'); await f.page.locator('[data-exh-action="close"]').click(); await openWork(f, 'user-open');
    await f.page.locator('[data-exh-action="user-practice"]').click(); const data = await userData(f); assert.equal(data.users.practice[7], 2); assert.equal(data.users.oiers[7].name, '七号'); assert.equal(f.requests.filter(r => r.method !== 'GET').length, 0); await f.done();
  });
  await check('user: legacy display options, recent twenty-contest metrics, and escaped imported profile names', async () => {
    const contests = Array.from({ length: 22 }, (_, i) => [`local/${i + 1}`, `Round ${i + 1}`, 1]), records = [[7, 0, 1, 1900, 2000], [7, 1, 1, 1950, 2000], [7, 2, 1, 1920, 1800], [8, 0, 1, 2000, 2000]];
    const users = { oiers: { 7: { name: '<img src=x onerror="window.injected=1">', records: [{ contest: '<script>evil()</script>', awards: '金牌', score: 100 }] } }, teachers: [], practice: {} };
    const f = await fixture('user_detail', '<a id="escaped-user" class="user-profile-name" href="/user/7">seven</a>', { udoc: { _id: 7, uname: 'seven' } }, { storage: userStorage({}, {}, {}), path: '/user/7' });
    await f.page.locator('[data-exh-fallback]').click(); await f.page.locator('#exhloj-local-import').fill(JSON.stringify({ 'exhloj.user': users, 'exhloj.ratedcontests': { contests, records }, 'model.user.display-name': 'display-realname-color', 'model.user.display-ccflevel': true })); await f.page.locator('[data-exh-action="import"]').click();
    await f.page.waitForFunction(() => document.querySelector('#escaped-user').textContent.includes('<img')); assert.equal(await f.page.locator('#escaped-user img').count(), 0); assert.equal(await f.page.locator('#exhloj-local-user-card script').count(), 0); assert.equal(await f.page.evaluate(() => window.injected), undefined);
    const metrics = await f.page.evaluate(() => window.UiContext.exhloj.user.ranking('down')); assert.deepEqual(metrics.map(row => [row.uid, row.down]), [[7, 30]]); const saved = await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.settings.v1'])); assert.equal(saved.userDisplay, 'display-realname-color'); assert.equal(saved.userCCF, true); await f.done();
  });
  await check('user: exact request budget allows calculation and blocks only the next network request', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage({ helperRequestLimit: 10 }, {}, {}), strictApi: true, api: req => new URL(req.url()).pathname.endsWith('/scoreboard') ? { body: { rows: [[{ type: 'rank', value: '#' }], [{ type: 'rank', value: '1' }, { type: 'user', raw: 7 }, { type: 'record', score: 100, raw: oid(0.1) }]] } } : undefined });
    await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-rated"]').click();
    const commands = n => Array.from({ length: n }, (_, i) => `contest:test/${i + 1},Round ${i + 1},1\nrating:test/${i + 1}`).join('\n');
    await f.page.locator('#exhloj-user-commands').fill(commands(10)); await f.page.locator('[data-exh-action="user-calculate"]').click(); await finished(f, 'user'); const data = await userData(f); assert.equal(data.ratings.records.at(-1)[3], 1810); assert.equal(f.requests.filter(r => r.kind === 'fetch').length, 10);
    await f.page.locator('#exhloj-user-commands').fill(commands(11)); await f.page.locator('[data-exh-action="user-calculate"]').click(); await finished(f, 'user'); assert.deepEqual(await userData(f), data); assert.equal(f.requests.filter(r => r.kind === 'fetch').length, 20); assert.match(await f.page.locator('[data-work-errors="user"]').textContent(), /10 次请求上限/); await f.done();
  });
  const oierExample = fs.readFileSync('tests/fixtures/oier-paste-example.md', 'utf8');
  const cleanFixtureCell = value => value.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').trim();
  const oierTableRows = oierExample.split('\n').filter(line => line.startsWith('|')).map(line => line.slice(1, -1).split('|').map(cleanFixtureCell)).filter((row, index) => index !== 1);
  const oierTSV = '王茂骅\n选手信息\n现在高二。\nOIerDb 排名：1（144743.67 分）。\nCCF 程序设计能力等级：10 级（仅供参考）。\n获奖信息\n' + oierTableRows.map(row => row.join('\t')).join('\n');
  async function clipboardPaste(f, text, html = '') { await f.page.locator('#exhloj-user-oier-paste').evaluate((area, data) => { const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', data.text); if (data.html) clipboardData.setData('text/html', data.html); area.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })); }, { text, html }); }

  await check('oier: profile and permission panels are outside nested accepted-problem columns and repair misplaced panels', async () => {
    const body = '<div class="section" id="profile-section"><div class="profile-header">Profile</div><div class="profile-content"><div id="accepted-problems"><h1>通过的题目</h1><div class="row">' + Array.from({ length: 4 }, (_, i) => `<div class="medium-3 columns"><ul><li>P${i + 1}</li></ul></div>`).join('') + '</div></div></div></div>';
    for (const missing of [false, true]) {
      const f = await fixture('user_detail', body, { udoc: { _id: 7, perm: 'BigInt::3' } }, { storage: userStorage(), path: '/user/7', extra: missing ? '<script>document.querySelector(".main > .row > .medium-3.columns").remove()</script>' : '' });
      assert.equal(await f.page.locator('#accepted-problems #exhloj-local-user-card, #accepted-problems #exhloj-local-permissions').count(), 0);
      assert.equal(await f.page.locator('.main > .row > .medium-3.columns > #exhloj-local-user-card').count(), 1); assert.equal(await f.page.locator('.main > .row > .medium-3.columns > #exhloj-local-permissions').count(), 1);
      await f.page.evaluate(() => { const bad = document.querySelector('#accepted-problems .medium-3'); bad.append(document.querySelector('#exhloj-local-user-card'), document.querySelector('#exhloj-local-permissions')); });
      await f.page.waitForFunction(() => document.querySelector('#exhloj-local-user-card').parentElement.matches('.main > .row > .medium-3.columns') && document.querySelector('#exhloj-local-permissions').parentElement.matches('.main > .row > .medium-3.columns'));
      assert.equal(await f.page.locator('#accepted-problems .medium-3.columns').count(), 4); assert.equal(f.requests.length, 1); await f.done();
    }
  });
  await check('oier: full supplied Markdown imports twenty-four awards with decimal scores and preserves unrelated fields', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage() }); await openEditor(f, 7);
    const before = await f.page.evaluate(() => JSON.stringify(window.__store)); await f.page.locator('#exhloj-user-oier-paste').fill(oierExample); await f.page.locator('[data-exh-action="user-oier-parse"]').click();
    assert.equal(await f.page.locator('[name="name"]').inputValue(), '王茂骅'); assert.equal(await f.page.locator('[name="level"]').inputValue(), '10'); assert.equal(await f.page.locator('[name="oierId"]').inputValue(), '1234'); assert.equal(await f.page.locator('[name="uname"]').inputValue(), 'seven'); assert.equal(await f.page.locator('[name="teacher"]').isChecked(), true); assert.equal(await f.page.locator('[name="practice"]').inputValue(), '123');
    assert.equal(await f.page.evaluate(() => JSON.stringify(window.__store)), before); const rows = JSON.parse(await f.page.locator('[name="awards"]').inputValue()); assert.equal(rows.length, 24);
    assert.deepEqual(rows[0], { contest: 'NOI2026', awards: '金牌', score: 641, fullScore: 705, rank: 12, participants: 283, province: '山东', school: '烟台青华中学', grade: '高一', contestId: 139, schoolId: 1091 });
    assert.equal(rows[15].score, 165.36); assert.equal(rows.at(-1).score, 188); assert.equal(rows.at(-1).school, '东北育才学校'); assert.match(await f.page.locator('#exhloj-user-oier-status').textContent(), /24 条获奖记录/);
    await f.page.locator('[data-exh-action="user-save"]').click(); const saved = await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.cache.v1'])['exhloj.user'].oiers[7]); assert.equal(saved.oierRank, 1); assert.equal(saved.oierScore, 144743.67); assert.equal(saved.records.length, 24);
    await f.page.locator('[name="name"]').fill('王茂骅（本地备注）'); await f.page.locator('[data-exh-action="user-save"]').click(); assert.equal(await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.cache.v1'])['exhloj.user'].oiers[7].oierScore), 144743.67); assert.equal(f.requests.length, 1); await f.done();
  });
  await check('oier: actual HTML paste autofills without fetching images, running scripts, or saving before confirmation', async () => {
    const html = '<h2>&lt;img src=x onerror="window.injected=1"&gt;</h2><h4>选手信息</h4><p>现在初二。</p><p>OIerDb 排名：<a href="/oier?page=1">1</a>（100.25 分）。</p><p>CCF 程序设计能力等级：7 级（仅供参考）。</p><h4>获奖信息</h4><table><tr><th>奖项</th><th>分数</th><th>选手排名</th><th>省份</th><th>就读学校</th><th>年级</th></tr><tr><td><a href="/contest/99">APIO2022 线上</a> <img src="https://evil.test/a.svg" alt="🥈" onerror="window.injected=1">银牌</td><td>165.36 / 300</td><td>31 / 191</td><td>辽宁</td><td><a href="/school/3099">学校 &amp; 附小</a></td><td>六年级</td></tr></table><script>window.injected=1</script>';
    const f = await fixture('user_detail', '', { udoc: { _id: 7, perm: 'BigInt::1' } }, { storage: userStorage(), path: '/user/7' }); await openEditor(f, 7); const before = await f.page.evaluate(() => JSON.stringify(window.__store));
    await clipboardPaste(f, '选手信息，复制网页时保留表格', html); assert.equal(await f.page.locator('[name="level"]').inputValue(), '7'); assert.equal(await f.page.locator('[name="name"]').inputValue(), '<img src=x onerror="window.injected=1">'); assert.equal(await f.page.evaluate(() => JSON.stringify(window.__store)), before);
    const rows = JSON.parse(await f.page.locator('[name="awards"]').inputValue()); assert.equal(rows[0].school, '学校 & 附小'); assert.equal(rows[0].schoolId, 3099); assert.equal(rows[0].contestId, 99);
    await f.page.locator('[data-exh-action="user-save"]').click(); assert.equal(await f.page.locator('#exhloj-local-user-card img, #exhloj-local-user-card script').count(), 0); assert.equal(await f.page.evaluate(() => window.injected), undefined); assert.equal(f.requests.length, 1); await f.done();
  });
  await check('oier: browser plain-text tables support tab-separated and per-cell line copies', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage() }); await openEditor(f, 7);
    for (const text of [oierTSV, oierTSV.replaceAll('\t', '\n')]) {
      await clipboardPaste(f, text); assert.equal(await f.page.locator('[name="name"]').inputValue(), '王茂骅'); const rows = JSON.parse(await f.page.locator('[name="awards"]').inputValue()); assert.equal(rows.length, 24); assert.equal(rows[15].score, 165.36); assert.equal(rows.at(-1).grade, '三年级');
    } assert.equal(f.requests.length, 1); await f.done();
  });
  await check('oier: academic years use September in Shanghai and ranking links never become profile IDs', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage() });
    const parsed = await f.page.evaluate(example => {
      const parse = window.UiContext.exhloj.user.parseOIer;
      return [parse(example, '', '', '2026-10-21T00:00:00Z'), parse(example, '', '', '2026-08-31T15:59:59Z'), parse(example, '', '', '2026-08-31T16:00:00Z'), parse(example, '', 'https://oier.baoshuo.dev/oier/4567')];
    }, oierExample);
    assert.deepEqual(parsed.slice(0, 3).map(data => data.profile.grade), [2028, 2027, 2028]); assert.equal(parsed[0].profile.oierId, undefined); assert.equal(parsed[0].profile.oierRank, 1); assert.equal(parsed[3].profile.oierId, 4567);
    await openEditor(f, 7); await f.page.locator('[name="oierURL"]').fill('https://oier.baoshuo.dev/oier/4567'); await clipboardPaste(f, oierExample); assert.equal(await f.page.locator('[name="oierId"]').inputValue(), '4567'); await f.done();
  });
  await check('oier: malformed paste is atomic, partial rows are reported and unrelated fields survive partial imports', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage() }); await openEditor(f, 7); const before = await f.page.locator('[name="name"]').inputValue();
    await clipboardPaste(f, 'random text'); assert.match(await f.page.locator('#exhloj-user-oier-status').textContent(), /识别失败/); assert.equal(await f.page.locator('[name="name"]').inputValue(), before);
    const partial = '新姓名\n选手信息\nCCF 程序设计能力等级：8 级。\n获奖信息\n|奖项|分数|选手排名|省份|就读学校|年级|\n|---|---|---|---|---|---|\n|CSP2025 提高 一等奖|399 / 400|1 / 100|浙江|本地学校|初三|\n|WC2025 金牌|bad / 300|1 / 100|浙江|本地学校|初三|';
    await clipboardPaste(f, partial); assert.equal(await f.page.locator('[name="name"]').inputValue(), '新姓名'); assert.equal(await f.page.locator('[name="grade"]').inputValue(), '2029'); assert.equal(await f.page.locator('[name="oierId"]').inputValue(), '1234'); assert.equal(JSON.parse(await f.page.locator('[name="awards"]').inputValue()).length, 1); assert.match(await f.page.locator('#exhloj-user-oier-status').textContent(), /1 行获奖信息未能识别/);
    await f.page.locator('[name="oierURL"]').fill('https://example.test/oier/9'); await clipboardPaste(f, oierExample); assert.match(await f.page.locator('#exhloj-user-oier-status').textContent(), /识别失败/); assert.equal(await f.page.locator('[name="name"]').inputValue(), '新姓名'); assert.equal(f.requests.length, 1); await f.done();
  });
  fs.writeFileSync('tests/output/browser-results.json', JSON.stringify({ version: require('../package.json').version, scriptSha256: crypto.createHash('sha256').update(script).digest('hex'), browser: browser.version(), passed: checks.length, checks }, null, 2));
  console.log(`All ${checks.length} browser scenarios passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); });
