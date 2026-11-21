'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs'), { join } = require('node:path'), vm = require('node:vm');
const source = readFileSync(join(__dirname, '../src/homework-plan-cache.js'), 'utf8');
const store = new Map(); let now = 1_000_000, quota = false;
function tab(locks) {
  const s = { uid: 12, domain: 'work', origin: 'https://oj.example', calls: 0,
    fetch: async (_job, path) => ({ title: path, secret: 'never-store-this' }) };
  const context = vm.createContext({ URL, navigator: { locks }, Date: { now: () => now }, location: { get origin() { return s.origin; } },
    user: () => ({ _id: s.uid }), domainId: () => s.domain, workError: msg => Error(msg),
    GM_getValue: (key, def) => store.has(key) ? store.get(key) : def,
    GM_setValue: (key, value) => { if (quota) throw Error('quota'); store.set(key, value); },
    checkJob: job => { if (job.owner !== s.uid || job.cancelled) throw Error('任务失效'); },
    jobJSON: (job, path) => { s.calls++; return s.fetch(job, path); }
  });
  const api = vm.runInContext(source + '\n;({read:homeworkPlanRead,reset:resetHomeworkPlanCache,ttl:HOMEWORK_PLAN_CACHE_TTL,key:HOMEWORK_PLAN_CACHE_KEY,cap:HOMEWORK_PLAN_CACHE_CHARS})', context);
  s.read = (path = '/d/' + s.domain + '/homework?page=1', view = 'list-v1', project = body => [body.title]) =>
    api.read({ owner: s.uid }, s.domain, path, view, project);
  s.reset = api.reset; s.api = api; return s;
}
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
(async () => {
  const a = tab(), b = tab();
  const req = defer(); a.fetch = () => req.promise;
  const first = a.read(), joined = a.read(); await Promise.resolve(); assert.equal(a.calls, 1);
  req.resolve({ title: '本域', secret: 'never-store-this' }); const [x, y] = await Promise.all([first, joined]);
  x.push('local mutation'); assert.equal(y.length, 1); assert.equal(y[0], '本域');
  assert.ok(!store.get(a.api.key).includes('never-store-this'));
  assert.equal((await b.read())[0], '本域'); assert.equal(b.calls, 0, 'reload/cross-tab cache');
  now += b.api.ttl - 1; assert.equal((await b.read())[0], '本域');
  now++; await b.read(); assert.equal(b.calls, 1, 'expired at ten minutes');
  b.uid = 13; await b.read(); b.domain = 'other'; await b.read(); b.origin = 'https://other.example'; await b.read();
  assert.equal(b.calls, 4, 'isolate user, domain and OJ origin');
  const elsewhere = b.calls; a.reset('work'); await b.read(); assert.equal(b.calls, elsewhere, 'scoped reset');
  const swapping = b.read(); b.uid++; await assert.rejects(swapping, /任务失效|登录|账号/); b.uid--;

  // One successful network response after a cross-tab reset must not overwrite the new result.
  const slowJob = defer(); const freshTab = tab(); a.fetch = () => slowJob.promise; const pending = a.read();
  await Promise.resolve(); freshTab.reset('work');
  freshTab.fetch = () => ({ title: 'new' }); assert.equal((await freshTab.read())[0], 'new');
  slowJob.resolve({ title: 'old' }); await assert.rejects(pending, /缓存已重置/);
  const next = tab(); assert.equal((await next.read())[0], 'new'); assert.equal(next.calls, 0);
  const onHit = next.read(); a.reset('work'); await assert.rejects(onHit, /缓存已重置/);
  next.fetch = () => { throw Error('403'); }; await assert.rejects(next.read(), /403/);
  next.fetch = () => ({ malformed: true });
  await assert.rejects(next.read(undefined, 'list-v1', () => { throw Error('invalid list'); }), /invalid list/);
  next.fetch = () => ({ title: 'recovered' }); assert.equal((await next.read())[0], 'recovered');
  assert.equal(next.calls, 3, 'failed transport and invalid projections not cached');
  await next.read(undefined, 'list-v2'); assert.equal(next.calls, 4, 'cache projection versions do not collide');

  const blocked = next.calls;
  for (const address of ['/d/foreign/homework', '/d/work/homework?token=xx', '/d/work/user/999',
    'https://evil.example/d/work/homework', '/d/work/homework/1/attend', '/d/work/record',
    '/d/work/homework?page=1&page=1', '/d/work/homework#part', '/d/work/homework?page=0',
    '/d/work/homework/123', '/d/work/homework/6ae9a637ffdcf3e7f6dd5b1e/', '/d/work/p/S42?tid=123']) {
    await assert.rejects(next.read(address));
  }
  next.uid = 0; await assert.rejects(next.read(), /先登录/); next.uid = 12;
  assert.equal(next.calls, blocked, 'guard before transport');
  await next.read('/d/work/homework/123/scoreboard?page=2', 'board');
  await next.read('/d/work/homework/6ae9a637ffdcf3e7f6dd5b1e/scoreboard', 'board');
  await next.read('/d/work/p/S42', 'status');
  await next.read('/d/work/user/12', 'my-solved');

  // Two pages may start the same scan before either page has persisted the response.
  const queues = new Map(), locks = { request(name, _options, fn) {
    const queued = (queues.get(name) || Promise.resolve()).then(fn); queues.set(name, queued.catch(() => {})); return queued;
  } };
  const tab1 = tab(locks), tab2 = tab(locks), jobs = [];
  for (const t of [tab1, tab2]) jobs.push(t.read('/d/work/homework?page=7'));
  const gathered = await Promise.all(jobs); assert.equal(tab1.calls + tab2.calls, 1, 'cross-tab lock and reread');
  assert.deepEqual(Array.from(gathered[0]), Array.from(gathered[1]));
  const restricted = tab({ request: () => { throw Error('Web Locks not available'); } });
  await restricted.read('/d/work/homework?page=9'); assert.equal(restricted.calls, 1);

  const quotaTab = tab(); quota = true; await quotaTab.read('/d/work/homework?page=8');
  await quotaTab.read('/d/work/homework?page=8'); assert.equal(quotaTab.calls, 1, 'quota fallback');
  quota = false;
  const capped = tab(); capped.fetch = (_job, path) => ({ title: '标题'.repeat(75000) + path });
  for (let i = 1; i < 14; i++) await capped.read('/d/work/homework?page=' + i, 'large-list');
  assert.ok(store.get(capped.api.key).length <= capped.api.cap, 'storage size bounded');
  store.set(capped.api.key, '{malformed'); const damaged = tab();
  assert.equal((await damaged.read())[0], '/d/work/homework?page=1');
  console.log('Homework plan cache: projection, TTL, quota, persistent reuse, scope, auth, endpoint and reset races OK.');
})().catch(error => { console.error(error); process.exitCode = 1; });
