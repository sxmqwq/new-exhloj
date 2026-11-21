  // Only validated planner projections are cached; raw Hydro pages can contain session/user details.
  const HOMEWORK_PLAN_CACHE_TTL = 10 * 60 * 1000;
  const HOMEWORK_PLAN_CACHE_KEY = 'exhloj.local.homework-plan.responses.v1';
  const HOMEWORK_PLAN_CACHE_CHARS = 1024 * 1024, HOMEWORK_PLAN_CACHE_ITEMS = 256;
  const homeworkPlanCache = (() => {
    let memory = [];
    const inflight = new Map(), localMarks = new Map();
    const fresh = (stamp, now) => Number.isFinite(stamp) && stamp <= now && now - stamp < HOMEWORK_PLAN_CACHE_TTL;
    const markerKey = scope => HOMEWORK_PLAN_CACHE_KEY + '.reset.' + scope;
    function revision(scope) {
      const local = localMarks.get(scope);
      try {
        const rawMark = GM_getValue(markerKey(scope), ''), storedMark = typeof rawMark === 'string' ? rawMark : '';
        // A failed marker write must still invalidate local requests. A newer marker from
        // another tab supersedes our local fallback.
        return local && storedMark === local.previous ? local.mark : storedMark;
      } catch { return local?.mark || ''; }
    }
    function load() {
      try {
        const raw = GM_getValue(HOMEWORK_PLAN_CACHE_KEY, '');
        if (typeof raw !== 'string' || !raw || raw.length > HOMEWORK_PLAN_CACHE_CHARS) return [];
        const rows = JSON.parse(raw);
        return Array.isArray(rows) ? rows.filter(r => Array.isArray(r) && r.length === 5 &&
          typeof r[0] === 'string' && typeof r[1] === 'string' && typeof r[2] === 'string' && typeof r[4] === 'string') : [];
      } catch { return []; }
    }
    // Newest first. Bound the actual encoded storage size as well as the number of URLs.
    function bounded(rows, now) {
      let size = 2; const kept = [];
      for (const r of rows) {
        if (!fresh(r[3], now) || r[4].length > HOMEWORK_PLAN_CACHE_CHARS) continue;
        const cost = JSON.stringify(r).length + 1;
        if (size + cost > HOMEWORK_PLAN_CACHE_CHARS) continue;
        kept.push(r); size += cost;
        if (kept.length === HOMEWORK_PLAN_CACHE_ITEMS) break;
      }
      return kept;
    }
    function write(rows) { GM_setValue(HOMEWORK_PLAN_CACHE_KEY, JSON.stringify(rows)); }
    function remember(row) {
      const now = Date.now(), other = r => r[0] !== row[0] || r[1] !== row[1];
      memory = bounded([row, ...memory.filter(other)], now);
      // A full/disabled persistent store must not turn a successful request into an error.
      try { write(bounded([row, ...load().filter(other)], now)); } catch {}
    }
    function reset(scope) {
      const mark = `${Date.now()}:${Math.random()}`;
      let previous = ''; try { previous = GM_getValue(markerKey(scope), '') || ''; } catch {}
      localMarks.set(scope, { previous, mark });
      for (const [id, flight] of inflight) if (flight.scope === scope) { flight.dead = true; inflight.delete(id); }
      memory = memory.filter(r => r[0] !== scope);
      // A separate per-scope marker prevents an earlier request in a different tab from repopulating
      // a reset cache. Even if the old payload temporarily survives, its generation cannot be read.
      let marked = false;
      try { GM_setValue(markerKey(scope), mark); marked = true; } catch {}
      try { write(bounded(load().filter(r => r[0] !== scope), Date.now())); }
      catch { if (!marked) throw workError('无法清除持久缓存，请检查脚本存储后重试'); }
    }
    function cached(scope, key, mark) {
      const now = Date.now(), match = r => r[0] === scope && r[1] === key && r[2] === mark && fresh(r[3], now);
      const r = memory.find(match) || load().find(match);
      if (r) { try { return { data: JSON.parse(r[4]), json: r[4] }; } catch { /* corrupted projection: refetch */ } }
    }
    async function read(scope, key, guard, fetchProjection, signal) {
      guard();
      const mark = revision(scope), hit = cached(scope, key, mark);
      if (hit) {
        await Promise.resolve(); guard();
        if (revision(scope) !== mark) throw workError('补题缓存已重置，请重新查找');
        return hit.data;
      }
      const id = JSON.stringify([scope, key, mark]);
      let flight = inflight.get(id);
      if (!flight) {
        flight = { scope, dead: false };
        const verify = () => {
          guard();
          if (flight.dead || revision(scope) !== mark) throw workError('补题缓存已重置，请重新查找');
        };
        const compute = async (recheck = false) => {
          verify();
          // Another tab may have filled this entry while this tab was waiting for its lock.
          const ready = recheck && cached(scope, key, mark); if (ready) return ready.json;
          const value = await fetchProjection();
          verify();
          const json = JSON.stringify(value);
          if (typeof json !== 'string') throw workError('作业接口数据不完整，未缓存');
          remember([scope, key, mark, Date.now(), json]); return json;
        };
        flight.result = Promise.resolve().then(async () => {
          let entered = false;
          try {
            const locks = globalThis.navigator?.locks;
            if (locks?.request) return await locks.request(HOMEWORK_PLAN_CACHE_KEY + ':' + id, signal ? { signal } : {},
              () => { entered = true; return compute(true); });
          } catch (error) { if (entered || signal?.aborted) throw error; }
          return compute();
        }).finally(() => { if (inflight.get(id) === flight) inflight.delete(id); });
        inflight.set(id, flight);
      }
      const result = await flight.result;
      guard();
      if (flight.dead || revision(scope) !== mark) throw workError('补题缓存已重置，请重新查找');
      return JSON.parse(result);
    }
    return { read, reset, revision };
  })();

  function homeworkPlanCacheScope(domain) {
    const uid = +user()._id;
    if (!Number.isSafeInteger(uid) || uid <= 0) throw workError('请先登录 OJ');
    if (typeof domain !== 'string' || !domain || domain !== domainId()) throw workError('当前域已变化，请重新查找');
    return JSON.stringify([location.origin, domain, uid]);
  }
  function resetHomeworkPlanCache(domain = domainId()) { homeworkPlanCache.reset(homeworkPlanCacheScope(domain)); }
  function homeworkPlanCacheRevision(domain = domainId()) { return homeworkPlanCache.revision(homeworkPlanCacheScope(domain)); }
  function homeworkPlanCachePath(domain, path, uid) {
    const u = new URL(path, location.origin), parts = u.pathname.replace(/\/$/, '').split('/');
    const allowedPage = v => /^[1-9]\d{0,5}$/.test(v);
    const id = v => /^(?:[\da-f]{24}|[1-9]\d{0,15})$/i.test(v);
    if (u.origin !== location.origin || u.username || u.password || u.hash || parts[1] !== 'd' || decodeURIComponent(parts[2] || '') !== domain)
      throw workError('补题查询只允许读取当前域');
    const [kind, arg, suffix] = parts.slice(3);
    // Reading a homework detail can start a timed assignment. Only its list and scoreboard are read.
    const hw = kind === 'homework' && (parts.length === 4 || (parts.length === 6 && id(arg) && suffix === 'scoreboard'));
    const profile = parts.length === 5 && kind === 'user' && arg === String(uid);
    const problem = parts.length === 5 && kind === 'p' && /^[\p{L}\p{N}_.-]{1,100}$/u.test(decodeURIComponent(arg));
    if (!hw && !profile && !problem) throw workError('不支持的补题查询地址');
    for (const [k, v] of u.searchParams) {
      if (u.searchParams.getAll(k).length !== 1 || !(hw && k === 'page' && allowedPage(v)))
        throw workError('不支持的补题查询参数');
    }
    u.searchParams.sort(); return u.pathname + u.search;
  }
  async function homeworkPlanRead(job, domain, path, view, project) {
    const scope = homeworkPlanCacheScope(domain), keyPath = homeworkPlanCachePath(domain, path, job.owner);
    if (typeof view !== 'string' || !/^[a-zA-Z][\w.-]{0,63}$/.test(view) || typeof project !== 'function') throw workError('补题缓存数据类型无效');
    const guard = () => {
      checkJob(job);
      if (scope !== homeworkPlanCacheScope(domain)) throw workError('账号或域已变化，请重新查找');
    };
    return homeworkPlanCache.read(scope, JSON.stringify([view, keyPath]), guard,
      async () => { const body = await jobJSON(job, keyPath); guard(); return project(body); }, job.controller?.signal);
  }
