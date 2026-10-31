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
let browser, activeCheck, failure;
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
        const response = window.__remote[options.url] || window.__remote[options.url.split('?')[0]];
        if (!response) return queueMicrotask(() => options.onerror(new Error('Unexpected external URL')));
        const timer = setTimeout(() => options.onload({ status: response.status || 200,
          responseText: response.text ?? JSON.stringify(response.json), finalUrl: response.finalUrl || options.url }), response.delay || 0);
        return { abort() { clearTimeout(timer); options.onabort?.(); } };
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
  activeCheck = name;
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
    await page.screenshot({ path: 'tests/output/settings-desktop.png' });
    const waiting = page.waitForEvent('download');
    await page.locator('[data-exh-action="export"]').click();
    const download = await waiting;
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(backup.format, 'exhloj'); assert.equal(backup.schemaVersion, 1);
    await page.setViewportSize({ width: 400, height: 800 });
    await page.screenshot({ path: 'tests/output/settings-mobile.png' });
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
    // The explicit click can share the initial remote-module request or retry it after failure.
    const count = f.requests.length; assert.ok(count === 2 || count === 3);
    await f.page.waitForTimeout(1200);
    assert.equal(f.requests.length, count, 'An error must not create background retries');
    const retry = f.page.waitForResponse(response => (response.request().headers().accept || '').includes('application/json'));
    await f.page.locator('[data-exh-action="problem-copy"]').click(); await retry;
    assert.equal(f.requests.length, count + 1, 'A later explicit click must make a fresh attempt'); await f.done();
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
    assert.match(script, /\/\/ @name\s+Extend HLOJ\n/); assert.equal(script.match(/^\/\/ @version\s+(\S+)/m)?.[1], require('../package.json').version);
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
      // A repeated page must keep the same record ID across second boundaries.
      const repeatedId = oid(0.1);
      const f = await fixture('homepage', '', {}, { storage: fast({ helperRequestLimit: 10, juanContests: false, juanHomeworks: false }), strictApi: true, api: req => {
        const u = new URL(req.url()), pageNo = Number(u.searchParams.get('page'));
        if (u.pathname === '/d/test/record') return { body: { rdocs: [{ _id: mode === 'repeat' ? repeatedId : oid(0.1, pageNo), uid: 1, pid: mode === 'repeat' ? 1 : pageNo, status: 1 }] } };
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
  async function openEditor(f, uid) { await openWork(f, 'user-open'); await f.page.locator('#exhloj-user-id').fill(String(uid)); await f.page.locator('#exhloj-local-dialog [data-exh-action="user-edit"]:not([data-uid])').click(); }

  await check('user audit: damaged user data cannot erase the intact section and requires explicit JSON repair', async () => {
    for (const damaged of ['users', 'ratings']) {
      const storage = structuredClone(userStorage()), raw = storage['exhloj.coreui.cache.v1'];
      if (damaged === 'users') raw['exhloj.user'].teachers = 'invalid';
      else raw['exhloj.ratedcontests'] = { ...ratingSample, records: [[7, 999, 1, 2000, 2200]] };
      const f = await fixture('homepage', '', {}, { storage });
      const data = await f.page.evaluate(() => window.UiContext.exhloj.user.getData());
      assert.deepEqual(data[damaged], raw[damaged === 'users' ? 'exhloj.user' : 'exhloj.ratedcontests'], 'Export retains the damaged original for repair');
      if (damaged === 'users') assert.deepEqual(data.ratings, ratingSample);
      else assert.equal(data.users.oiers[7].name, '七号');
      if (damaged === 'users') assert.equal(await f.page.evaluate(() => window.UiContext.exhloj.user.ranking('current').length), 3);
      const before = await f.page.evaluate(() => JSON.stringify(window.__store));
      await openEditor(f, 7); await f.page.locator('[name="name"]').fill('手动编辑'); await f.page.locator('[data-exh-action="user-save"]').click();
      assert.equal(await f.page.evaluate(() => JSON.stringify(window.__store)), before); assert.match(await f.page.locator('#exhloj-local-toast').textContent(), /格式异常/);
      await f.page.locator('[data-exh-action="close"]').click(); await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-json"]').click();
      const goodUsers = { oiers: { 7: { name: '修复资料' } }, teachers: [], practice: {} }, goodRatings = { contests: [], records: [] };
      await f.page.locator('#exhloj-user-json').fill(JSON.stringify(damaged === 'users' ? goodRatings : goodUsers));
      await f.page.locator('[data-exh-action="user-json-save"]').click(); assert.equal(await f.page.evaluate(() => JSON.stringify(window.__store)), before);
      await f.page.locator('#exhloj-user-json').fill(JSON.stringify(damaged === 'users' ? goodUsers : goodRatings));
      await f.page.locator('[data-exh-action="user-json-save"]').click();
      const repaired = await f.page.evaluate(() => window.UiContext.exhloj.user.getData());
      if (damaged === 'users') { assert.equal(repaired.users.oiers[7].name, '修复资料'); assert.deepEqual(repaired.ratings, ratingSample); }
      else { assert.equal(repaired.users.oiers[7].name, '七号'); assert.deepEqual(repaired.ratings.records, []); }
      await f.done();
    }
  });
  await check('user audit: a delayed Rating calculation cannot overwrite newly saved Rating data', async () => {
    const board = { rows: [[{ type: 'rank', value: '1' }, { type: 'user', raw: 7 }, { type: 'record', score: 100, raw: oid(0.1) }]], tdoc: { rule: 'oi' } };
    const f = await fixture('homepage', '', {}, { storage: userStorage(), strictApi: true, api: { [`GET /d/test/contest/${tid}/scoreboard`]: { delay: 600, body: board } } });
    await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-rated"]').click();
    await f.page.locator('#exhloj-user-commands').fill(`version:2\ncontest:test/${tid},Round,1\nrating:test/${tid}`);
    await f.page.locator('[data-exh-action="user-calculate"]').click(); await f.page.waitForFunction(() => document.querySelector('[data-work-progress="user"]').textContent.includes('/scoreboard'));
    const changed = await f.page.evaluate(() => {
      const raw = window.__store['exhloj.coreui.cache.v1'], cache = typeof raw === 'string' ? JSON.parse(raw) : raw;
      cache['exhloj.ratedcontests'].records[0][3] = 2300; cache['exhloj.ratedcontests'].commands = '# saved in another tab';
      window.__store['exhloj.coreui.cache.v1'] = JSON.stringify(cache); return window.__store['exhloj.coreui.cache.v1'];
    });
    await finished(f, 'user'); assert.equal(await f.page.evaluate(() => window.__store['exhloj.coreui.cache.v1']), changed);
    assert.match(await f.page.locator('[data-work-errors="user"]').textContent(), /Rating.*已变化/);
    await f.page.locator('[data-exh-action="user-calculate"]').click(); await f.page.waitForFunction(() => document.querySelector('[data-work-progress="user"]').textContent.includes('/scoreboard'));
    await f.page.evaluate(() => {
      const cache = JSON.parse(window.__store['exhloj.coreui.cache.v1']); cache['exhloj.user'].oiers[7].name = '结算期间编辑资料';
      window.__store['exhloj.coreui.cache.v1'] = JSON.stringify(cache);
    });
    await finished(f, 'user'); const retry = await f.page.evaluate(() => window.UiContext.exhloj.user.getData());
    assert.equal(retry.ratings.records[0][3], 1801); assert.equal(retry.users.oiers[7].name, '结算期间编辑资料'); await f.done();
  });

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
  await check('user: Hydro level badges and avatar links never become a second username', async () => {
    const users = { oiers: { 7: { name: '陈思宁', uname: '陈思宁', level: 6 } }, teachers: [], practice: {} };
    const body = `<style>.user-profile-link{font:16px Arial}.user-profile-badge{background:#89b967;color:white;padding:2px 5px}.user-profile-avatar{background:#eee;border-radius:50%;vertical-align:middle}.fixture-user-row{padding:12px;width:max-content}</style>
      <table class="fixture-user-row"><tbody><tr><td style="padding-right:32px">21</td><td class="col--user"><span class="user-profile-link">
        <a id="avatar-only" href="/user/7"><img class="small user-profile-avatar v-center" width="20" height="20" alt=""></a>
        <a id="hydro-name" class="user-profile-name uname--lv6" href="/user/7">陈思宁</a>
        <a id="site-level" class="user-profile-badge v-center badge--lv6" href="/user/7" data-tooltip="LV 6: Top 5%">LV 6</a>
        <span id="site-role" class="user-profile-badge v-center badge--mod">MOD</span>
      </span></td></tr></tbody></table>`;
    const f = await fixture('contest_scoreboard', body, { udict: { 7: { uname: '陈思宁' } } }, { storage: userStorage({ userDisplay: 'display-username-realname-color', userCCF: true }, users, {}) });
    assert.equal(await f.page.locator('#site-level').textContent(), 'LV 6');
    assert.equal(await f.page.locator('#site-level').getAttribute('class'), 'user-profile-badge v-center badge--lv6');
    assert.equal(await f.page.locator('#site-level').getAttribute('data-tooltip'), 'LV 6: Top 5%');
    assert.equal(await f.page.locator('#site-role').textContent(), 'MOD');
    assert.equal(await f.page.locator('#avatar-only img').count(), 1);
    assert.equal(await f.page.locator('#avatar-only').textContent(), '');
    assert.equal(await f.page.locator('#hydro-name').textContent(), '陈思宁 (陈思宁)');
    assert.equal(await f.page.locator('.exhloj-user-ccf').count(), 1);
    await f.page.locator('.fixture-user-row').screenshot({ path: 'tests/output/user-badge-row.png' });
    await f.page.evaluate(() => { document.querySelector('#site-level').textContent = 'LV 7'; document.body.append(document.createElement('p')); });
    await f.page.waitForTimeout(300);
    assert.equal(await f.page.locator('#site-level').textContent(), 'LV 7');
    assert.equal(await f.page.locator('.exhloj-user-ccf').count(), 1);
    await f.page.locator('[data-exh-fallback]').click(); await f.page.locator('[name="userModule"]').uncheck(); await f.page.locator('[data-exh-action="save-settings"]').click();
    assert.equal(await f.page.locator('#hydro-name').textContent(), '陈思宁');
    assert.equal(await f.page.locator('#site-level').textContent(), 'LV 7');
    assert.equal(await f.page.locator('.exhloj-user-ccf').count(), 0);
    assert.equal(f.requests.length, 1); await f.done();
  });
  await check('user: CCF rosette SVG uses the three level colors without adding text glyphs', async () => {
    const levels = [2, 3, 5, 6, 7, 8, 10];
    const users = { oiers: Object.fromEntries(levels.map(level => [100 + level, { name: `Level ${level}`, level }])), teachers: [], practice: {} };
    const body = '<div id="badge-tiers" style="font:16px Arial;width:max-content;padding:12px">' + levels.map(level => `<p><a class="user-profile-name" id="ccf-${level}" href="/user/${100 + level}">CCF ${level} 级</a></p>`).join('') + '</div>';
    const f = await fixture('homepage', body, {}, { storage: userStorage({ userCCF: true }, users, {}) });
    for (const level of levels) {
      const link = f.page.locator(`#ccf-${level}`), badge = link.locator('.exhloj-user-ccf');
      assert.equal(await link.textContent(), `CCF ${level} 级`);
      assert.equal(await badge.count(), level < 3 ? 0 : 1);
      if (level < 3) continue;
      const svg = badge.locator('svg'); assert.equal(await svg.count(), 1);
      assert.equal(await svg.getAttribute('viewBox'), '0 0 16 16');
      assert.equal(await svg.evaluate(node => node.namespaceURI), 'http://www.w3.org/2000/svg');
      assert.equal(await badge.getAttribute('aria-label'), `CCF ${level} 级`);
      assert.equal(await badge.evaluate(node => getComputedStyle(node).color), level <= 5 ? 'rgb(94, 185, 94)' : level <= 7 ? 'rgb(52, 152, 219)' : 'rgb(241, 196, 15)');
      const bounds = await svg.boundingBox(); assert.ok(bounds.width >= 14 && bounds.width <= 18 && Math.abs(bounds.width - bounds.height) < 1);
    }
    await f.page.locator('#badge-tiers').screenshot({ path: 'tests/output/user-badge-tiers.png' });
    assert.equal(f.requests.length, 1); await f.done();
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
  const OIER_TEST_API = 'https://oier.api.baoshuo.dev';
  const oierStatic = fs.readFileSync('tests/fixtures/oierdb-static.json', 'utf8'), oierResult = fs.readFileSync('tests/fixtures/oierdb-result.txt', 'utf8');
  function oierRemotes(statics = oierStatic, result = oierResult) {
    const remote = {};
    for (const [kind, text] of [['static', statics], ['result', result]]) {
      const sha512 = crypto.createHash('sha512').update(text).digest('hex');
      remote[`${OIER_TEST_API}/${kind}.info.json`] = { text: JSON.stringify({ sha512, size: Buffer.byteLength(text) }) };
      remote[`${OIER_TEST_API}/${kind}.${sha512.slice(0, 7)}.${kind === 'static' ? 'json' : 'txt'}`] = { text };
    }
    return remote;
  }
  async function savedOIer(f) { return f.page.evaluate(() => { const cache = window.__store['exhloj.coreui.cache.v1']; return (typeof cache === 'string' ? JSON.parse(cache) : cache)['exhloj.user']; }); }
  async function gmRequests(f) { return f.page.evaluate(() => window.__gm); }
  async function importOIer(f, id) { await f.page.locator('[name="oierURL"]').fill(`${OIER_TEST_API.replace('oier.api.', 'oier.')}/oier/${id}`); await f.page.locator('[data-exh-action="user-oier-import"]').click(); await finished(f, 'oier'); }
  async function pasteOIerURL(f, text) { await f.page.locator('[name="oierURL"]').evaluate((area, text) => { const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text); area.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })); }, text); }

  function delayedOIerRemotes() {
    const remote = oierRemotes(); for (const [key, value] of Object.entries(remote)) if (/\/static\.[a-f\d]{7}\.json$/.test(key)) value.delay = 600;
    return remote;
  }
  await check('oier audit: a refresh preserves saved profile edits even when the binding is unchanged', async () => {
    const users = structuredClone(userSample); users.oiers[8].oierId = 2345;
    const f = await fixture('homepage', '', {}, { storage: userStorage({}, users), remote: delayedOIerRemotes() }); await openWork(f, 'user-open');
    await f.page.locator('[data-exh-action="user-oier-refresh-all"]').click(); await f.page.waitForFunction(() => window.__gm.length === 3);
    await f.page.evaluate(() => {
      const raw = window.__store['exhloj.coreui.cache.v1'], cache = typeof raw === 'string' ? JSON.parse(raw) : raw;
      Object.assign(cache['exhloj.user'].oiers[7], { name: '下载期间保存的姓名', level: 3 }); window.__store['exhloj.coreui.cache.v1'] = JSON.stringify(cache);
    });
    await finished(f, 'oier'); const data = await savedOIer(f);
    assert.equal(data.oiers[7].oierId, 1234); assert.equal(data.oiers[7].name, '下载期间保存的姓名'); assert.equal(data.oiers[7].level, 3);
    assert.equal(data.oiers[8].name, '示例乙'); assert.match(await f.page.locator('[data-work-errors="oier"]').textContent(), /本地资料已变化/); await f.done();
  });
  await check('oier audit: link reads preserve edits typed into the form while downloading', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage(), remote: delayedOIerRemotes() }); await openEditor(f, 7);
    const before = await savedOIer(f);
    await f.page.locator('[data-exh-action="user-oier-import"]').click(); await f.page.waitForFunction(() => window.__gm.length === 3);
    await f.page.locator('[name="name"]').fill('尚未保存的姓名'); await finished(f, 'oier');
    assert.equal(await f.page.locator('[name="name"]').inputValue(), '尚未保存的姓名'); assert.equal(await f.page.locator('[name="level"]').inputValue(), '6');
    assert.deepEqual(await savedOIer(f), before); assert.match(await f.page.locator('#exhloj-user-oier-status').textContent(), /编辑内容已变化/); await f.done();
  });
  await check('oier audit: refreshing saved data does not replace a newly edited form draft', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage(), remote: delayedOIerRemotes() }); await openEditor(f, 7);
    await f.page.locator('[data-exh-action="user-oier-refresh"]').click(); await f.page.waitForFunction(() => window.__gm.length === 3);
    await f.page.locator('[name="name"]').fill('保留编辑框草稿'); await finished(f, 'oier');
    assert.equal((await savedOIer(f)).oiers[7].name, '王茂骅'); assert.equal(await f.page.locator('[name="name"]').inputValue(), '保留编辑框草稿');
    assert.match(await f.page.locator('[data-work-errors="oier"]').textContent(), /编辑内容已变化/); await f.done();
  });

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
  await check('oier: profile links import all awards and persist the exact ID after saving, including guests', async () => {
    const users = structuredClone(userSample); users.oiers[7].oierId = 0;
    const f = await fixture('homepage', '', {}, { userId: 0, storage: userStorage({}, users), remote: oierRemotes() }); await openEditor(f, 7);
    assert.equal(await f.page.locator('#exhloj-user-oier-paste').count(), 0);
    assert.equal(await f.page.locator('[name="oierId"]').getAttribute('readonly'), '');
    const before = await f.page.evaluate(() => JSON.stringify(window.__store)); await importOIer(f, 1234);
    assert.equal(await f.page.locator('[name="name"]').inputValue(), '王茂骅'); assert.equal(await f.page.locator('[name="level"]').inputValue(), '10');
    assert.equal(await f.page.locator('[name="grade"]').inputValue(), '2028'); assert.equal(await f.page.locator('[name="oierId"]').inputValue(), '1234');
    assert.equal(await f.page.locator('[name="uname"]').inputValue(), 'seven'); assert.equal(await f.page.locator('[name="teacher"]').isChecked(), true); assert.equal(await f.page.locator('[name="practice"]').inputValue(), '123');
    assert.equal(await f.page.evaluate(() => JSON.stringify(window.__store)), before);
    const rows = JSON.parse(await f.page.locator('[name="awards"]').inputValue()); assert.equal(rows.length, 24);
    assert.deepEqual(rows[0], { contest: 'NOI2026', awards: '金牌', score: 641, fullScore: 705, rank: 12, participants: 283, province: '山东', school: '烟台青华中学', grade: '高一', contestId: 139, schoolId: 1091 });
    assert.equal(rows[15].score, 165.36); assert.equal(rows.at(-1).school, '东北育才学校');
    await f.page.locator('[data-exh-action="user-save"]').click(); const data = await savedOIer(f), saved = data.oiers[7];
    assert.equal(saved.oierId, 1234); assert.equal(saved.oierRank, 2); assert.equal(saved.oierScore, 144743.67); assert.ok(saved.oierSyncedAt > 0); assert.match(saved.oierVersion, /^[a-f\d]{7}\/[a-f\d]{7}$/);
    assert.deepEqual(await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.cache.v1'])['exhloj.ratedcontests']), ratingSample);
    const requests = await gmRequests(f); assert.equal(requests.length, 4); assert.ok(requests.every(r => r.method === 'GET' && r.anonymous === true && new URL(r.url).origin === OIER_TEST_API));
    assert.equal(f.requests.length, 1); await f.done();
  });
  await check('oier: pasting a profile URL reads data, while page text, ranking links and foreign URLs make no requests', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage(), remote: oierRemotes() }); await openEditor(f, 7);
    for (const value of ['王茂骅\n选手信息\n获奖信息', '1234', '/oier/1234', 'https://oier.baoshuo.dev/oier?page=1', 'https://oier.baoshuo.dev/contest/139', 'https://oier.baoshuo.dev.evil.test/oier/1234', 'https://u:p@oier.baoshuo.dev/oier/1234', 'https://oier.baoshuo.dev:8443/oier/1234']) {
      await f.page.locator('[name="oierURL"]').fill(value); await f.page.locator('[data-exh-action="user-oier-import"]').click();
      assert.match(await f.page.locator('#exhloj-user-oier-status').textContent(), /读取失败/);
    }
    assert.deepEqual(await gmRequests(f), []);
    await pasteOIerURL(f, 'https://oier.baoshuo.dev/oier/1234/?from=share#profile'); await finished(f, 'oier');
    assert.equal(await f.page.locator('[name="name"]').inputValue(), '王茂骅'); assert.equal(await f.page.locator('[name="oierId"]').inputValue(), '1234');
    assert.equal((await gmRequests(f)).length, 4); assert.equal((await savedOIer(f)).oiers[7].name, '七号');
    await importOIer(f, 999999); assert.match(await f.page.locator('#exhloj-user-oier-status').textContent(), /未找到/);
    assert.equal(await f.page.locator('[name="name"]').inputValue(), '王茂骅'); assert.equal(await f.page.locator('[name="oierId"]').inputValue(), '1234'); await f.done();
  });
  await check('oier: refreshing a new database updates only OIerDb fields and immediately saves the bound ID', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage(), remote: oierRemotes() }); await openEditor(f, 7); await importOIer(f, 1234); await f.page.locator('[data-exh-action="user-save"]').click();
    const updated = oierResult.replace('WMH,王茂骅', 'WMH,数据库新姓名').replace(',1000,10,', ',1000,9,').replace('139:1091:641.0:', '139:1091:650:');
    await f.page.evaluate(remote => { window.__remote = remote; }, oierRemotes(oierStatic, updated));
    await f.page.locator('[data-exh-action="user-oier-refresh"]').click(); await finished(f, 'oier');
    const saved = await savedOIer(f); assert.equal(saved.oiers[7].name, '数据库新姓名'); assert.equal(saved.oiers[7].level, 9); assert.equal(saved.oiers[7].records[0].score, 650); assert.equal(saved.oiers[7].oierId, 1234);
    assert.equal(saved.oiers[7].uname, 'seven'); assert.deepEqual(saved.teachers, [7]); assert.equal(saved.practice[7], 123);
    assert.deepEqual(await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.cache.v1'])['exhloj.ratedcontests']), ratingSample);
    assert.equal((await gmRequests(f)).length, 8); assert.equal(f.requests.length, 1); await f.done();
  });
  await check('oier: bulk refresh shares one download and keeps missing, unbound and unrelated local data', async () => {
    const users = structuredClone(userSample); users.oiers[9] = { name: '同绑定', uname: 'nine', oierId: 1234 }; users.oiers[11] = { name: '另一人', uname: 'eleven', oierId: 2345 }; users.oiers[13] = { name: '保留', uname: 'missing', oierId: 999999 };
    const f = await fixture('homepage', '', {}, { storage: userStorage({}, users), remote: oierRemotes() }); await openWork(f, 'user-open');
    const before = await f.page.evaluate(() => window.UiContext.exhloj.user.getData().users);
    assert.match(await f.page.locator('#exhloj-user-oier-bindings').textContent(), /4 人已绑定/);
    await f.page.locator('[data-exh-action="user-oier-refresh-all"]').click(); await finished(f, 'oier'); const saved = await savedOIer(f);
    assert.equal(saved.oiers[7].name, '王茂骅'); assert.equal(saved.oiers[9].name, '王茂骅'); assert.equal(saved.oiers[9].uname, 'nine'); assert.equal(saved.oiers[11].name, '示例乙'); assert.equal(saved.oiers[11].oierRank, 2);
    assert.deepEqual(saved.oiers[13], before.oiers[13]); assert.deepEqual(saved.oiers[8], before.oiers[8]); assert.deepEqual(saved.teachers, users.teachers); assert.deepEqual(saved.practice, users.practice);
    assert.match(await f.page.locator('[data-work-progress="oier"]').textContent(), /3\/4/); assert.match(await f.page.locator('[data-work-errors="oier"]').textContent(), /999999/);
    assert.equal((await gmRequests(f)).length, 4); await f.done();
  });
  await check('oier: unchanged database versions recheck metadata and reuse data files', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage(), remote: oierRemotes() }); await openWork(f, 'user-open');
    for (let i = 0; i < 2; i++) { await f.page.locator('[data-exh-action="user-oier-refresh-all"]').click(); await finished(f, 'oier'); }
    const requests = await gmRequests(f); assert.equal(requests.length, 6); assert.equal(requests.filter(r => new URL(r.url).pathname.endsWith('.info.json')).length, 4);
    assert.equal(requests.filter(r => new URL(r.url).pathname.startsWith('/result.') && !new URL(r.url).pathname.endsWith('.info.json')).length, 1);
    assert.equal((await savedOIer(f)).oiers[7].records.length, 24); await f.done();
  });
  await check('oier: refresh preserves edits made while downloading and skips a changed person binding', async () => {
    const users = structuredClone(userSample); users.oiers[8].oierId = 2345;
    const remote = oierRemotes(); for (const [key, value] of Object.entries(remote)) if (/\/static\.[a-f\d]{7}\.json$/.test(key)) value.delay = 500;
    const f = await fixture('homepage', '', {}, { storage: userStorage({}, users), remote }); await openWork(f, 'user-open');
    await f.page.locator('[data-exh-action="user-oier-refresh-all"]').click(); await f.page.waitForFunction(() => window.__gm.length === 3);
    await f.page.evaluate(() => {
      const raw = window.__store['exhloj.coreui.cache.v1'], cache = typeof raw === 'string' ? JSON.parse(raw) : raw;
      Object.assign(cache['exhloj.user'].oiers[7], { name: '手动修改', oierId: 7777, uname: 'edited-uname' });
      cache['exhloj.user'].practice[7] = 999; cache['exhloj.ratedcontests'].commands = '# edited while downloading';
      window.__store['exhloj.coreui.cache.v1'] = JSON.stringify(cache);
    }); await finished(f, 'oier');
    const saved = await savedOIer(f); assert.equal(saved.oiers[7].name, '手动修改'); assert.equal(saved.oiers[7].oierId, 7777); assert.equal(saved.oiers[7].uname, 'edited-uname'); assert.equal(saved.practice[7], 999); assert.equal(saved.oiers[8].name, '示例乙');
    assert.equal(await f.page.evaluate(() => JSON.parse(window.__store['exhloj.coreui.cache.v1'])['exhloj.ratedcontests'].commands), '# edited while downloading');
    assert.match(await f.page.locator('[data-work-errors="oier"]').textContent(), /绑定已变化/); await f.done();
  });
  await check('oier: HTTP, redirect, malformed, corrupt and incomplete downloads preserve old data and remain retryable', async () => {
    for (const mode of ['http', 'redirect', 'metadata', 'hash', 'truncated', 'schema']) {
      const remote = oierRemotes(), infoKey = OIER_TEST_API + '/static.info.json', resultKey = Object.keys(remote).find(key => /\/result\.[a-f\d]{7}\.txt$/.test(key));
      if (mode === 'http') remote[infoKey].status = 503;
      if (mode === 'redirect') remote[infoKey].finalUrl = 'https://example.test/data';
      if (mode === 'metadata') remote[infoKey].text = '{"sha512":"../bad","size":1}';
      if (mode === 'hash') remote[resultKey].text = remote[resultKey].text.replace('200000', '200001');
      if (mode === 'truncated') remote[resultKey].text = remote[resultKey].text.slice(0, -5);
      if (mode === 'schema') Object.assign(remote, oierRemotes(oierStatic, 'invalid,data\n'));
      const f = await fixture('homepage', '', {}, { storage: userStorage(), remote }); await openWork(f, 'user-open'); const before = await savedOIer(f);
      await f.page.locator('[data-exh-action="user-oier-refresh-all"]').click(); await finished(f, 'oier'); assert.deepEqual(await savedOIer(f), before);
      assert.match(await f.page.locator('[data-work-progress="oier"]').textContent(), /未完成/);
      await f.page.evaluate(remote => { window.__remote = remote; }, oierRemotes()); await f.page.locator('[data-exh-action="user-oier-refresh-all"]').click(); await finished(f, 'oier');
      assert.equal((await savedOIer(f)).oiers[7].name, '王茂骅'); await f.done();
    }
  });
  await check('oier: cancellation aborts the download and a changed editor link cannot receive stale data', async () => {
    const remote = oierRemotes(); for (const [key, value] of Object.entries(remote)) if (/\/static\.[a-f\d]{7}\.json$/.test(key)) value.delay = 500;
    const f = await fixture('homepage', '', {}, { storage: userStorage(), remote }); await openEditor(f, 7); const before = await savedOIer(f);
    await f.page.locator('[data-exh-action="user-oier-import"]').click(); await f.page.waitForFunction(() => window.__gm.length === 3);
    await f.page.locator('[data-exh-action="work-cancel"][data-kind="oier"]').click(); await finished(f, 'oier'); assert.deepEqual(await savedOIer(f), before);
    assert.equal(await f.page.locator('[name="name"]').inputValue(), '七号'); assert.equal((await gmRequests(f)).length, 3);
    await f.page.locator('[data-exh-action="user-oier-import"]').click(); await f.page.waitForFunction(() => window.__gm.length === 6);
    await f.page.locator('[name="oierURL"]').fill('https://oier.baoshuo.dev/oier/2345'); await finished(f, 'oier');
    assert.equal(await f.page.locator('[name="name"]').inputValue(), '七号'); assert.deepEqual(await savedOIer(f), before); assert.match(await f.page.locator('#exhloj-user-oier-status').textContent(), /已变化/); await f.done();
  });
  await check('oier: disabling the user module cancels public-data reads without saving profiles', async () => {
    const remote = oierRemotes(); for (const value of Object.values(remote)) value.delay = 500;
    const f = await fixture('homepage', '', {}, { storage: userStorage(), remote }); await openEditor(f, 7); const before = await savedOIer(f);
    await f.page.locator('[data-exh-action="user-oier-import"]').click(); await f.page.waitForFunction(() => window.__gm.length === 1);
    await f.page.locator('[data-exh-action="close"]').click(); await f.page.locator('[data-exh-fallback]').click(); await f.page.locator('[name="userModule"]').uncheck(); await f.page.locator('[data-exh-action="save-settings"]').click();
    await f.page.waitForTimeout(600); assert.deepEqual(await savedOIer(f), before); assert.equal((await gmRequests(f)).length, 1); await f.done();
  });
  await check('oier: zero-based contest and school IDs, missing scores, grade overrides and empty records match the database', async () => {
    const f = await fixture('homepage', '', {}, { storage: userStorage(), remote: oierRemotes() }); await openEditor(f, 7);
    // The matched NFLS site also runs on HTTP, where Web Crypto may be unavailable.
    await f.page.evaluate(() => Object.defineProperty(window.crypto, 'subtle', { value: undefined }));
    for (const [id, grade, score] of [[5001, '高三', 90], [2345, '高一', 80], [5002, '高二', '']]) {
      await importOIer(f, id); const record = JSON.parse(await f.page.locator('[name="awards"]').inputValue())[0]; assert.equal(record.contestId, 0); assert.equal(record.schoolId, 0); assert.equal(record.participants, 3); assert.equal(record.score, score); assert.equal(record.grade, grade);
    }
    await importOIer(f, 7777); assert.equal(await f.page.locator('[name="level"]').inputValue(), '0'); assert.equal(await f.page.locator('[name="grade"]').inputValue(), '0'); assert.deepEqual(JSON.parse(await f.page.locator('[name="awards"]').inputValue()), []);
    await f.page.locator('[data-exh-action="user-save"]').click(); assert.equal((await savedOIer(f)).oiers[7].oierId, 7777); await f.done();
  });
  await check('oier: database text is rendered literally and selected profile refresh works outside the editor', async () => {
    const unsafe = oierResult.replace('WMH,王茂骅', 'WMH,<img src=x onerror=window.injected=1>');
    const f = await fixture('user_detail', '', { udoc: { _id: 7, perm: 'BigInt::1' } }, { path: '/user/7', storage: userStorage(), remote: oierRemotes(oierStatic, unsafe) });
    await f.page.locator('#exhloj-local-user-card [data-exh-action="user-oier-refresh"]').click(); await finished(f, 'oier');
    assert.equal((await savedOIer(f)).oiers[7].name, '<img src=x onerror=window.injected=1>'); assert.equal(await f.page.locator('#exhloj-local-user-card img, #exhloj-local-user-card script').count(), 0); assert.equal(await f.page.evaluate(() => window.injected), undefined);
    assert.equal(f.requests.length, 1); await f.done();
  });
  const quickResult = [
    '9101,CSN,陈思宁,0,2022,100,0,6,0:0:90:1:25:3',
    '9102,ljh,李景和,0,2022,99,0,5,0:0:80:2:25:3',
    '9103,ljh,林嘉禾,0,2022,98,0,4,0:0:70:3:25:4',
    '9104,zyl,赵亦岚,0,2022,97,0,3,',
    '9105,wmh,王木河,0,2022,96,0,3,',
    '9106,ab,虚构同名,0,2022,95,0,3,',
    '9107,cd,虚构同名,0,2022,94,0,3,',
    '9108,an,安宁,0,2022,93,0,3,',
    '9109,xm,先明,0,2022,92,0,3,',
    '9110,xam,西安明,0,2022,91,0,3,',
    '9111,ll,吕岚,0,2022,90,0,3,',
    '9120,zhx,张皓轩,0,2022,89,0,3,',
    '9121,zhx,张浩轩,0,2022,88,0,3,',
    '9122,zhx,张昊轩,0,2022,87,0,3,',
    '9123,zhx,张鸿翔,0,2022,86,0,3,',
    '9130,zyx,张亦欣,0,2022,85,0,3,',
    '9131,zyx,张艺馨,0,2022,84,0,3,',
    '9132,zyx,张宇翔,0,2022,83,0,3,',
    '9140,hx,郝轩,0,2022,82,0,3,',
    '9150,slx,单乐鑫,0,2022,81,0,3,'
  ].join('\n') + '\n';
  function quickRanking(rows, size = 10, domain = 'test') {
    return req => {
      const url = new URL(req.url()); if (url.pathname !== `/d/${domain}/ranking`) return;
      const number = Number(url.searchParams.get('page'));
      return { body: { udocs: rows.slice((number - 1) * size, number * size), page: number, upcount: Math.max(1, Math.ceil(rows.length / size)), ucount: rows.length } };
    };
  }
  async function quickFixture(rows, options = {}) {
    return fixture('homepage', '', {}, { storage: userStorage({}, { oiers: {}, teachers: [], practice: {} }), remote: oierRemotes(oierStatic, quickResult), api: quickRanking(rows), strictApi: true, ...options });
  }
  async function openQuick(f) { await openWork(f, 'user-open'); await f.page.locator('[data-exh-action="user-oier-quick-open"]').click(); }
  async function scanQuick(f) { await f.page.locator('[data-exh-action="user-oier-quick-scan"]').click(); await finished(f, 'oier'); }
  async function candidateIds(f) { return f.page.locator('[data-oier-candidate]').evaluateAll(rows => rows.map(row => +row.dataset.oierCandidate)); }

  await check('oier: quick scans all ranking pages, deduplicates visible users, previews only and confirms one', async () => {
    const rows = [{ _id: 91, uname: 'AC_陈_思_宁_2026' }, { _id: 92, uname: 'prefix_WangMuHe_suffix' }, { _id: 93, uname: 'xx_LJH_2026' }, { _id: 94, uname: 'unknown123' }, { _id: 95, uname: '赵亦岚' }, { _id: 91, uname: 'AC_陈_思_宁_2026' }, { _id: 0, uname: '陈思宁' }, { _id: 96, uname: '' }];
    const users = { oiers: { 91: { name: '原资料', uname: 'old-name', oierId: 0 } }, teachers: [91], practice: { 91: 77 } };
    const f = await quickFixture(rows, { api: quickRanking(rows, 3), storage: userStorage({}, users) }); await openQuick(f);
    const before = await f.page.evaluate(() => JSON.stringify(window.__store)); await scanQuick(f);
    assert.deepEqual(await candidateIds(f), [91, 92, 93, 95]); assert.match(await f.page.locator('#exhloj-oier-quick-summary').textContent(), /排名页 5 人/);
    assert.match(await f.page.locator('#exhloj-oier-quick-results').textContent(), /2 位候选/);
    assert.equal(await f.page.locator('[data-oier-choice]:checked').count(), 0); assert.equal(await f.page.evaluate(() => JSON.stringify(window.__store)), before);
    assert.equal((await gmRequests(f)).length, 4); assert.equal(f.requests.filter(r => r.kind === 'fetch').length, 3);
    await f.page.locator('[data-exh-action="user-oier-quick-apply"][data-uid="91"]').click();
    const saved = await savedOIer(f); assert.equal(saved.oiers[91].oierId, 9101); assert.equal(saved.oiers[91].uname, rows[0].uname); assert.equal(saved.oiers[91].name, '陈思宁');
    assert.deepEqual(saved.teachers, [91]); assert.equal(saved.practice[91], 77); assert.equal(saved.oiers[92], undefined); assert.deepEqual(await candidateIds(f), [92, 93, 95]);
    assert.ok(f.requests.every(r => r.method === 'GET')); assert.deepEqual(await f.page.evaluate(() => { const raw = window.__store['exhloj.coreui.cache.v1']; return (typeof raw === 'string' ? JSON.parse(raw) : raw)['exhloj.ratedcontests'].records; }), ratingSample.records); await f.done();
  });
  await check('oier: quick normalizes tone marks, umlauts, case, full pinyin fragments and initials', async () => {
    const rows = [{ _id: 91, uname: 'AC_WÁNG_MÙ_HÉ_2026' }, { _id: 92, uname: '王_木_河' }, { _id: 93, uname: 'prefixWangMuHe123' }, { _id: 94, uname: 'WMH_2026' }, { _id: 95, uname: 'LǙLÁN_2026' }];
    const f = await quickFixture(rows); await openQuick(f); await scanQuick(f); assert.deepEqual(await candidateIds(f), [91, 92, 93, 94, 95]);
    assert.match(await f.page.locator('[data-oier-candidate="91"]').textContent(), /全拼：wangmuhe（完整姓名读音）/);
    assert.match(await f.page.locator('[data-oier-candidate="92"]').textContent(), /汉字：王木河/);
    assert.match(await f.page.locator('[data-oier-candidate="94"]').textContent(), /首字母：wmh/);
    assert.match(await f.page.locator('#exhloj-oier-quick-results').textContent(), /同一 OIerDb ID/); await f.done();
  });
  await check('oier: quick queues duplicate names and conflicting fragments with at most three candidates for review', async () => {
    const rows = [{ _id: 91, uname: '虚构同名' }, { _id: 92, uname: 'ljh' }, { _id: 93, uname: 'csn_wmh' }, { _id: 94, uname: 'xianming' }, { _id: 95, uname: '完全没有匹配的名字' }];
    const f = await quickFixture(rows); await openQuick(f); await scanQuick(f); assert.deepEqual(await candidateIds(f), [91, 92, 93, 94]);
    assert.match(await f.page.locator('#exhloj-oier-quick-summary').textContent(), /未入队 1 人/); assert.deepEqual((await savedOIer(f)).oiers, {}); await f.done();
  });
  await check('oier: quick skips existing bindings without downloading a database and excludes unrelated context users', async () => {
    const users = { oiers: { 91: { name: '保留', oierId: 999999, records: [] } }, teachers: [], practice: {} };
    const f = await quickFixture([{ _id: 91, uname: '陈思宁' }], { storage: userStorage({}, users), json: { udict: { 999: { _id: 999, uname: '王木河' } } } });
    await openQuick(f); await scanQuick(f); assert.deepEqual(await candidateIds(f), []); assert.equal((await gmRequests(f)).length, 0);
    assert.match(await f.page.locator('#exhloj-oier-quick-summary').textContent(), /已绑定跳过 1 人/); assert.equal((await savedOIer(f)).oiers[91].oierId, 999999); await f.done();
  });
  await check('oier: quick rescans reuse versioned files, and removing candidates never saves profiles', async () => {
    const f = await quickFixture([{ _id: 91, uname: 'CSN' }]); await openQuick(f); await scanQuick(f);
    await f.page.locator('[data-exh-action="user-oier-quick-remove"][data-uid="91"]').click(); assert.deepEqual(await candidateIds(f), []); assert.deepEqual((await savedOIer(f)).oiers, {});
    await scanQuick(f); assert.deepEqual(await candidateIds(f), [91]); const requests = await gmRequests(f); assert.equal(requests.length, 6);
    assert.equal(requests.filter(r => /\/result\.[a-f\d]{7}\.txt/.test(r.url)).length, 1); assert.equal(requests.filter(r => /\/static\.[a-f\d]{7}\.json/.test(r.url)).length, 1); await f.done();
  });
  await check('oier: quick incomplete ranking scans publish no candidates and do not download data', async () => {
    for (const mode of ['repeat', 'limit', 'forbidden', 'schema']) {
      const f = await quickFixture([], { storage: userStorage(mode === 'limit' ? { helperPageLimit: 1 } : {}, { oiers: {}, teachers: [], practice: {} }), api: req => {
        if (!new URL(req.url()).pathname.endsWith('/ranking')) return;
        if (mode === 'forbidden') return { status: 403, body: {} };
        if (mode === 'schema') return { body: { udict: { 91: { uname: '陈思宁' } } } };
        return { body: { udocs: [{ _id: 91, uname: '陈思宁' }], ...(mode === 'limit' ? { upcount: 2 } : {}) } };
      } });
      await openQuick(f); await scanQuick(f); assert.deepEqual(await candidateIds(f), []); assert.equal((await gmRequests(f)).length, 0);
      assert.match(await f.page.locator('[data-work-progress="oier"]').textContent(), /未完成/); assert.deepEqual((await savedOIer(f)).oiers, {}); await f.done();
    }
  });
  await check('oier: quick cancellation during download leaves storage and queue untouched', async () => {
    const remote = oierRemotes(oierStatic, quickResult); for (const [key, value] of Object.entries(remote)) if (/\/static\.[a-f\d]{7}\.json$/.test(key)) value.delay = 1000;
    const f = await quickFixture([{ _id: 91, uname: '陈思宁' }], { remote }); await openQuick(f);
    await f.page.locator('[data-exh-action="user-oier-quick-scan"]').click(); await f.page.waitForFunction(() => window.__gm.length === 3);
    await f.page.locator('[data-exh-action="work-cancel"]').click(); await finished(f, 'oier'); await f.page.waitForTimeout(50);
    assert.deepEqual(await candidateIds(f), []); assert.deepEqual((await savedOIer(f)).oiers, {}); assert.match(await f.page.locator('[data-work-progress="oier"]').textContent(), /已取消/); await f.done();
  });
  await check('oier: quick preserves changed local profiles and unrelated data when confirming a batch', async () => {
    const f = await quickFixture([{ _id: 91, uname: '陈思宁' }, { _id: 92, uname: 'WMH' }]); await openQuick(f); await scanQuick(f);
    await f.page.evaluate(() => { const raw = window.__store['exhloj.coreui.cache.v1'], cache = typeof raw === 'string' ? JSON.parse(raw) : raw; cache['exhloj.user'].oiers[91] = { name: '后来手动编辑', oierId: 7777, records: [] }; cache['exhloj.user'].practice[92] = 123; cache['exhloj.user'].teachers.push(92); window.__store['exhloj.coreui.cache.v1'] = JSON.stringify(cache); });
    await f.page.locator('[data-exh-action="user-oier-quick-select"][data-selected="yes"]').click(); await f.page.locator('[data-exh-action="user-oier-quick-apply"]:not([data-uid])').click();
    const saved = await savedOIer(f); assert.equal(saved.oiers[91].name, '后来手动编辑'); assert.equal(saved.oiers[91].oierId, 7777); assert.equal(saved.oiers[92].oierId, 9105); assert.equal(saved.practice[92], 123); assert.deepEqual(saved.teachers, [92]);
    assert.match(await f.page.locator('#exhloj-oier-quick-results').textContent(), /本地资料已变化/); await f.done();
  });
  await check('oier: quick rejects confirmations after account or route changes', async () => {
    for (const mode of ['account', 'route']) {
      const f = await quickFixture([{ _id: 91, uname: '陈思宁' }]); await openQuick(f); await scanQuick(f);
      await f.page.evaluate(mode => { if (mode === 'account') window.UserContext._id = 100; else { history.pushState({}, '', '/d/other/ranking'); document.body.append(document.createElement('span')); } }, mode);
      if (mode === 'route') await f.page.waitForTimeout(500);
      await f.page.locator('[data-exh-action="user-oier-quick-apply"][data-uid="91"]').click(); assert.deepEqual((await savedOIer(f)).oiers, {}); await f.done();
    }
  });
  await check('oier: quick paginates candidates and preserves selections across pages without auto-saving', async () => {
    const rows = Array.from({ length: 61 }, (_, i) => ({ _id: 100 + i, uname: `王木河_${i}` }));
    const f = await quickFixture(rows, { api: quickRanking(rows, 40) }); await openQuick(f); await scanQuick(f); assert.equal((await candidateIds(f)).length, 30);
    await f.page.locator('[data-exh-action="user-oier-quick-select"][data-selected="yes"]').click();
    await f.page.locator('[data-exh-action="user-oier-quick-page"][data-step="1"]').click(); assert.equal(await f.page.locator('[data-oier-choice]:checked').count(), 0);
    await f.page.locator('[data-exh-action="user-oier-quick-select"][data-selected="yes"]').click();
    assert.deepEqual((await savedOIer(f)).oiers, {}); await f.page.locator('[data-exh-action="user-oier-quick-apply"]:not([data-uid])').click();
    assert.equal(Object.keys((await savedOIer(f)).oiers).length, 60); assert.deepEqual(await candidateIds(f), [160]);
    await f.page.locator('[data-exh-action="user-oier-quick-remove"][data-uid="160"]').click(); assert.equal((await savedOIer(f)).oiers[160], undefined); await f.done();
  });
  await check('oier: quick renders usernames literally and supports a chosen domain with no background scans', async () => {
    const rows = [{ _id: 91, uname: '<img src=x onerror=window.injected=1>陈思宁' }];
    const f = await quickFixture(rows, { api: quickRanking(rows, 10, 'my-team') }); await openQuick(f); assert.equal(f.requests.length, 1); assert.equal((await gmRequests(f)).length, 0);
    await f.page.locator('#exhloj-oier-quick-form [name="domain"]').fill('my-team'); await scanQuick(f);
    assert.deepEqual(await candidateIds(f), [91]); assert.equal(await f.page.locator('#exhloj-oier-quick-results img, #exhloj-oier-quick-results script').count(), 0);
    assert.equal(await f.page.evaluate(() => window.injected), undefined); assert.equal(await f.page.locator('[data-oier-candidate="91"] a').first().getAttribute('href'), '/d/my-team/user/91'); await f.done();
  });
  await check('oier: quick small candidate groups recognize numeric full-pinyin examples and preserve all matches', async () => {
    const rows = [{ _id: 201, uname: 'zhanghaoxuan2024' }, { _id: 202, uname: 'DL24zhangyixin' }, { _id: 203, uname: 'studentzhanghaoxuan2024' }, { _id: 204, uname: 'zhx' }, { _id: 205, uname: 'zhanghaoxuan_zhangyixin' }, { _id: 206, uname: 'haoxuan2024' }];
    const f = await quickFixture(rows); await openQuick(f); await scanQuick(f);
    assert.deepEqual(await candidateIds(f), [201, 202, 203, 206]);
    for (const [uid, count] of [[201, 3], [202, 2], [203, 3], [206, 1]]) {
      const group = f.page.locator(`[data-oier-options="${uid}"]`); assert.equal(await group.evaluate(node => node.open), false);
      assert.equal(await group.locator('[data-oier-profile]').count(), count); assert.match(await group.locator('summary').textContent(), new RegExp(`${count} 位候选`));
    }
    assert.match(await f.page.locator('[data-oier-candidate="201"]').textContent(), /全拼：zhanghaoxuan/);
    assert.match(await f.page.locator('[data-oier-candidate="202"]').textContent(), /全拼：zhangyixin/);
    assert.deepEqual(await f.page.locator('[data-oier-options="201"] [data-oier-profile]').evaluateAll(nodes => nodes.map(node => +node.dataset.oierProfile)), [9120, 9121, 9122]);
    assert.deepEqual(await f.page.locator('[data-oier-options="202"] [data-oier-profile]').evaluateAll(nodes => nodes.map(node => +node.dataset.oierProfile)), [9130, 9131]);
    assert.match(await f.page.locator('#exhloj-oier-quick-results').textContent(), /搜索命中 4 人，超过 3 人/);
    assert.match(await f.page.locator('#exhloj-oier-quick-results').textContent(), /搜索命中 5 人，超过 3 人/);
    assert.match(await f.page.locator('#exhloj-oier-quick-results details').last().textContent(), /全拼：zhanghaoxuan/);
    assert.deepEqual((await savedOIer(f)).oiers, {}); assert.equal((await gmRequests(f)).length, 4); await f.done();
  });
  await check('oier: quick small candidate groups require choosing one profile and save exactly that choice', async () => {
    const f = await quickFixture([{ _id: 201, uname: 'zhanghaoxuan2024' }, { _id: 202, uname: 'DL24zhangyixin' }]); await openQuick(f); await scanQuick(f);
    const group = f.page.locator('[data-oier-options="201"]'), confirm = f.page.locator('[data-exh-action="user-oier-quick-apply"][data-uid="201"]');
    assert.equal(await group.locator('input[type="radio"]:checked').count(), 0); assert.equal(await confirm.isDisabled(), true);
    await group.locator('summary').click(); assert.equal(await group.locator('[data-oier-profile="9121"]').isVisible(), true);
    await group.locator('input[value="9121"]').check(); await group.locator('input[value="9122"]').check();
    assert.equal(await group.locator('input[type="radio"]:checked').count(), 1); assert.match(await group.locator('summary').textContent(), /张昊轩 #9122/);
    assert.equal(await f.page.locator('[data-oier-choice="201"]').isChecked(), true); assert.deepEqual((await savedOIer(f)).oiers, {});
    await group.locator('summary').click(); assert.equal(await group.locator('[data-oier-profile="9121"]').isVisible(), false);
    await confirm.click(); const saved = await savedOIer(f); assert.equal(saved.oiers[201].oierId, 9122); assert.equal(saved.oiers[201].name, '张昊轩'); assert.equal(saved.oiers[201].uname, 'zhanghaoxuan2024'); assert.equal(saved.oiers[202], undefined);
    assert.equal((await gmRequests(f)).length, 4); await f.done();
  });
  await check('oier: quick small candidate groups cannot be guessed by bulk confirmation', async () => {
    const f = await quickFixture([{ _id: 201, uname: 'zhanghaoxuan2024' }, { _id: 202, uname: 'DL24zhangyixin' }, { _id: 206, uname: 'haoxuan2024' }]); await openQuick(f); await scanQuick(f);
    await f.page.locator('[data-exh-action="user-oier-quick-select"][data-selected="yes"]').click(); await f.page.locator('[data-exh-action="user-oier-quick-apply"]:not([data-uid])').click();
    let saved = await savedOIer(f); assert.equal(saved.oiers[206].oierId, 9140); assert.equal(saved.oiers[201], undefined); assert.equal(saved.oiers[202], undefined);
    assert.match(await f.page.locator('#exhloj-oier-quick-results').textContent(), /有多个候选，请先展开并选择一人/);
    for (const [uid, id] of [[201, 9121], [202, 9131]]) { const group = f.page.locator(`[data-oier-options="${uid}"]`); await group.locator('summary').click(); await group.locator(`input[value="${id}"]`).check(); }
    await f.page.locator('[data-exh-action="user-oier-quick-apply"]:not([data-uid])').click(); saved = await savedOIer(f); assert.equal(saved.oiers[201].oierId, 9121); assert.equal(saved.oiers[202].oierId, 9131); assert.equal(saved.oiers[206].oierId, 9140); await f.done();
  });
  await check('oier: quick full pinyin verifies whole name readings instead of unrelated shared initials', async () => {
    const f = await quickFixture([{ _id: 201, uname: 'wangmaohua2024' }, { _id: 202, uname: 'WMH2024' }, { _id: 203, uname: 'zhangyuxiang2024' }]); await openQuick(f); await scanQuick(f);
    assert.deepEqual(await candidateIds(f), [202, 203]);
    assert.equal(await f.page.locator('[data-oier-options="203"] [data-oier-profile]').count(), 1); assert.equal(await f.page.locator('[data-oier-options="203"] [data-oier-profile="9132"]').count(), 1);
    assert.deepEqual((await savedOIer(f)).oiers, {}); await f.done();
  });
  await check('oier: quick full pinyin supports polyphonic characters without relying on one initials spelling', async () => {
    const f = await quickFixture([{ _id: 201, uname: 'shanlexin2024' }, { _id: 202, uname: 'DL24danyuexin' }]); await openQuick(f); await scanQuick(f);
    assert.deepEqual(await candidateIds(f), [201, 202]); for (const uid of [201, 202]) assert.equal(await f.page.locator(`[data-oier-options="${uid}"] [data-oier-profile="9150"]`).count(), 1); await f.done();
  });
  await check('oier: quick small candidate choice and expansion survive pagination and fit the dialog', async () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => ({ _id: 500 + i, uname: `王木河_${i}` })), { _id: 600, uname: 'zhanghaoxuan2024' }];
    const f = await quickFixture(rows, { api: quickRanking(rows, 40) }); await openQuick(f); await scanQuick(f);
    await f.page.locator('[data-exh-action="user-oier-quick-page"][data-step="1"]').click(); const group = f.page.locator('[data-oier-options="600"]'); await group.locator('summary').click(); await group.locator('input[value="9122"]').check();
    await f.page.locator('[data-exh-action="user-oier-quick-page"][data-step="-1"]').click(); await f.page.locator('[data-exh-action="user-oier-quick-page"][data-step="1"]').click();
    assert.equal(await group.evaluate(node => node.open), true); assert.equal(await group.locator('input[value="9122"]').isChecked(), true); assert.equal(await f.page.locator('[data-oier-choice="600"]').isChecked(), true);
    await f.page.setViewportSize({ width: 1280, height: 900 }); await f.page.screenshot({ path: 'tests/output/oier-quick-desktop.png' });
    await f.page.setViewportSize({ width: 400, height: 800 }); const bounds = await f.page.locator('#exhloj-local-dialog').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 400);
    await f.page.screenshot({ path: 'tests/output/oier-quick-mobile.png' }); assert.deepEqual((await savedOIer(f)).oiers, {}); await f.done();
  });
  console.log(`All ${checks.length} browser scenarios passed.`);
})().catch(error => { failure = { check: activeCheck, message: error.message }; console.error(error); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync('tests/output/browser-results.json', JSON.stringify({ version: require('../package.json').version,
    scriptSha256: crypto.createHash('sha256').update(script).digest('hex'), browser: browser?.version(), passed: checks.length, checks, failure }, null, 2));
  if (browser) await browser.close();
});
