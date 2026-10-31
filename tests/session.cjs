// Local HTTP integration tests: real HttpOnly cookies and redirects, no OJ account or mocked fetch.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'dist/exhloj.user.js'), 'utf8');
const checks = [], requests = [], faults = new Map();
let browser, origin, failure, activeCheck;
const json = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
function pageHTML(url, loggedIn) {
  const account = url.pathname === '/home/account';
  const name = account ? 'home_account' : 'problem_detail';
  const context = { UserContext: { _id: loggedIn ? 42 : 0 }, UiContext: { domain: { _id: 'test' } } };
  return `<!doctype html><html data-page="${name}"><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body>
    <nav><a id="normal" href="/d/test/p/2">Normal navigation</a>
      <a id="pjax" data-site-route href="/d/test/p/3">PJAX navigation</a></nav>
    <main class="main"><div class="row"><div class="medium-9 columns"><ul class="problem__tags"></ul></div><div class="medium-3 columns"></div></div></main>
    <script id="site-context" type="application/json">${JSON.stringify(context)}</script>
    <script>
      Object.assign(window, JSON.parse(document.getElementById('site-context').textContent));
      document.addEventListener('click', async event => {
        const link = event.target.closest('[data-site-route]'); if (!link) return;
        event.preventDefault();
        const response = await fetch(link.href, { headers: { Accept: 'text/html' } });
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        history.pushState({}, '', link.href);
        Object.assign(window, JSON.parse(doc.querySelector('#site-context').textContent));
        document.querySelector('main').replaceWith(doc.querySelector('main'));
        document.documentElement.dataset.page = doc.documentElement.dataset.page;
        window.dispatchEvent(new Event('pjax:end'));
      });
    </script><script src="/userscript.js"></script></body></html>`;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin || 'http://localhost');
  const wantsJSON = (req.headers.accept || '').includes('application/json');
  requests.push({ path: url.pathname, method: req.method, json: wantsJSON });
  if (req.method === 'POST' && url.pathname === '/user/login') {
    res.writeHead(303, { Location: '/d/test/p/1', 'Set-Cookie': 'exhloj_test_session=fixture-only; HttpOnly; SameSite=Lax; Path=/' }); return res.end();
  }
  if (url.pathname === '/userscript.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(script); }
  if (url.pathname === '/user/login') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end('<!doctype html><html><head><link rel="icon" href="data:,"></head><body><form method="post"><button>Sign in to fixture</button></form></body></html>');
  }
  const loggedIn = (req.headers.cookie || '').split('; ').includes('exhloj_test_session=fixture-only');
  if (wantsJSON) {
    const fault = faults.get(url.pathname);
    if (fault?.gate) await fault.gate;
    if (fault?.kind === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>Login required</html>'); }
    if (fault?.kind === 'redirect') { res.writeHead(302, { Location: '/user/login' }); return res.end(); }
    if (fault?.status) return json(res, fault.status, { error: 'Fixture failure' });
    if (!loggedIn) return json(res, 401, { error: 'Session required' });
    return json(res, 200, { pdoc: { content: `Statement ${url.pathname}`, config: {} } });
  }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(pageHTML(url, loggedIn));
});
async function fixture() {
  faults.clear(); requests.length = 0;
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.unsafeWindow = window;
    const settings = JSON.stringify({ remote: false, autoAttend: false });
    const store = { 'exhloj.coreui.settings.v1': settings };
    window.GM_getValue = (key, fallback) => store[key] ?? fallback;
    window.GM_setValue = (key, value) => { store[key] = value; };
    window.GM_registerMenuCommand = () => {};
    window.GM_xmlhttpRequest = () => { throw new Error('Unexpected cross-site request'); };
    window.__clipboard = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => window.__clipboard.push(text) }, configurable: true });
  });
  // Reject any network destination outside the local fixture, even if business defaults change.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/user/login');
  await Promise.all([page.waitForURL(origin + '/d/test/p/1'), page.getByRole('button', { name: 'Sign in to fixture' }).click()]);
  await page.waitForSelector('[data-exh-action="problem-copy"]');
  const cookies = await context.cookies(origin);
  assert.ok(cookies.find(cookie => cookie.name === 'exhloj_test_session')?.httpOnly);
  return { page, context, cookies, async done() {
    try {
      assert.deepEqual(await context.cookies(origin), cookies, 'Navigation and plugin errors must preserve the session cookie');
      assert.equal(requests.filter(r => r.method !== 'GET' && r.path !== '/user/login').length, 0, 'No automatic account mutation');
      assert.equal(requests.filter(r => /logout/.test(r.path)).length, 0, 'No logout requests');
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  } };
}
const copy = async f => { await f.page.locator('[data-exh-action="problem-copy"]').click(); };
const copied = async (f, text) => { await f.page.waitForFunction(text => window.__clipboard.at(-1) === text, text); };
const apiCount = () => requests.filter(r => r.json).length;
async function check(name, fn) {
  if (process.env.EXHLOJ_TEST_FILTER && !name.includes(process.env.EXHLOJ_TEST_FILTER)) return;
  activeCheck = name; await fn(); checks.push(name); console.log('PASS', name);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://oj.hailiangedu.com:${server.address().port}`;
  browser = await chromium.launch({ ...(process.env.EXHLOJ_CHROME ? { executablePath: process.env.EXHLOJ_CHROME } : {}), headless: true,
    args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP oj.hailiangedu.com 127.0.0.1'] });
  await check('session: full navigation and plugin controls preserve the HttpOnly session', async () => {
    const f = await fixture();
    try {
      await copy(f); await copied(f, 'Statement /d/test/p/1');
      await f.page.locator('[data-exh-fallback]').click(); await f.page.locator('[data-exh-action="close"]').click();
      await Promise.all([f.page.waitForURL(origin + '/d/test/p/2'), f.page.locator('#normal').click()]);
      await copy(f); await copied(f, 'Statement /d/test/p/2');
      await f.page.goto(origin + '/home/account'); await f.page.waitForSelector('#exhloj-local-avatar');
      assert.equal(await f.page.evaluate(() => UserContext._id), 42);
    } finally { await f.done(); }
  });
  await check('session: PJAX and back navigation keep the account and use the new page data', async () => {
    const f = await fixture();
    try {
      await copy(f); await copied(f, 'Statement /d/test/p/1');
      await f.page.locator('#pjax').click(); await f.page.waitForURL(origin + '/d/test/p/3');
      await copy(f); await copied(f, 'Statement /d/test/p/3');
      await f.page.waitForFunction(() => !!UiContext.exhloj?.core);
      assert.equal(await f.page.evaluate(() => UiContext.exhloj.core.getUserId()), 42);
      await f.page.goBack(); await f.page.waitForURL(origin + '/d/test/p/1');
      await copy(f); await copied(f, 'Statement /d/test/p/1');
    } finally { await f.done(); }
  });
  await check('session: failed page JSON can be retried manually on the same page without polling', async () => {
    const f = await fixture();
    try {
      faults.set('/d/test/p/1', { status: 500 });
      await copy(f); await f.page.waitForFunction(() => document.querySelector('#exhloj-local-toast')?.textContent.includes('500'));
      const count = apiCount(); await f.page.waitForTimeout(400); assert.equal(apiCount(), count);
      faults.clear(); await copy(f); await copied(f, 'Statement /d/test/p/1'); assert.equal(apiCount(), count + 1);
    } finally { await f.done(); }
  });
  await check('session: 401, 403, HTML login responses and redirects do not log out or trigger retry loops', async () => {
    for (const fault of [{ status: 401 }, { status: 403 }, { kind: 'html' }, { kind: 'redirect' }]) {
      const f = await fixture();
      try {
        faults.set('/d/test/p/1', fault); const before = apiCount();
        await copy(f); await f.page.waitForSelector('#exhloj-local-toast[data-error="true"]');
        const message = await f.page.locator('#exhloj-local-toast').textContent();
        if (fault.status) assert.ok(message.includes(String(fault.status)));
        if (fault.kind === 'html') assert.match(message, /JSON/);
        await f.page.waitForTimeout(400); assert.equal(apiCount(), before + 1);
        assert.equal(requests.filter(r => r.path === '/user/login').length, 2, 'Plugin must not follow a login redirect');
        faults.clear(); await copy(f); await copied(f, 'Statement /d/test/p/1');
      } finally { await f.done(); }
    }
  });
  await check('session: late responses cannot cross a route or account change before DOM refresh', async () => {
    for (const change of ['route', 'account']) {
      const f = await fixture(); let release;
      try {
        faults.set('/d/test/p/1', { gate: new Promise(resolve => { release = resolve; }) });
        const pending = f.page.waitForRequest(request => (request.headers().accept || '').includes('application/json'));
        await copy(f); await pending;
        await f.page.evaluate(change => {
          if (change === 'route') history.replaceState({}, '', '/d/test/p/4');
          else UserContext = { _id: 99 };
        }, change);
        release(); await f.page.waitForSelector('#exhloj-local-toast[data-error="true"]');
        assert.deepEqual(await f.page.evaluate(() => window.__clipboard), []);
        faults.clear(); await copy(f); await copied(f, `Statement /d/test/p/${change === 'route' ? 4 : 1}`);
      } finally { release?.(); await f.done(); }
    }
  });
  console.log(`All ${checks.length} session scenarios passed.`);
})().catch(error => { failure = { check: activeCheck, message: error.message }; console.error(error); process.exitCode = 1; }).finally(async () => {
  fs.mkdirSync(path.join(root, 'tests/output'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests/output/session-results.json'), JSON.stringify({ version: require('../package.json').version,
    scriptSha256: crypto.createHash('sha256').update(script).digest('hex'), browser: browser?.version(),
    fixture: 'local HTTP server; real HttpOnly cookies; no live OJ account', passed: checks.length, checks, failure }, null, 2));
  if (browser) await browser.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
});
