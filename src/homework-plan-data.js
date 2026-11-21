  // The reader stores only the validated projection, scoped to this domain and account.
  const scanHomeworkPlan = (() => {
    const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const own = (v, k) => Object.prototype.hasOwnProperty.call(v || {}, k);
    const fail = message => { throw new Error(message); };
    const trim = v => typeof v === 'string' ? v.trim().slice(0, 250) : '';
    const nat = v => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isSafeInteger(+v) && +v >= 0;
    const id = v => {
      if (obj(v)) v = v.docId ?? v.$oid ?? v.pid;
      const s = String(v ?? '').replace(/^ObjectId::/, '');
      return /^[\w-]{1,100}$/.test(s) ? s : '';
    };
    function date(v) {
      if (obj(v)) v = v.$date;
      if (v === '' || v == null) return null;
      const n = typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : Date.parse(v);
      return Number.isFinite(n) ? n : null;
    }
    function confirmDomain(v, domain) {
      if (v?.domainId != null && String(v.domainId) !== domain) fail('返回的数据不属于当前域');
    }
    function homework(doc, domain, expected) {
      if (!obj(doc)) fail('缺少作业信息');
      const key = id(doc.docId ?? doc._id);
      if (!key || expected && key !== expected || doc.rule && doc.rule !== 'homework') fail('作业标识或类型不符');
      confirmDomain(doc, domain);
      return { id: key, title: trim(doc.title) || key, begin: date(doc.beginAt) };
    }
    function pageInfo(v, page, list = false) {
      if (v.page != null && (!nat(v.page) || +v.page !== page)) fail('返回了错误的页码');
      const count = v.pageCount ?? (list ? v.tpcount : v.spcount) ?? v.totalPages;
      if (count == null) return null;
      if (!nat(count) || +count < page && !(page === 1 && +count === 0)) fail('分页信息无效');
      return +count;
    }
    function profile(body, uid, domain) {
      // Hydro user_detail.pdocs is the list of accepted problems. pdict/psdocs on this page are editorials.
      const who = body.udoc?._id ?? body.udoc?.uid;
      if (body.isSelfProfile === false || who != null && (!nat(who) || +who !== uid)) throw Object.assign(new Error('登录身份与当前账号不符，已停止查询'), { accountMismatch:true });
      if (!nat(who) || !Array.isArray(body.pdocs)) fail('无法确认当前账号的通过列表');
      const solved = new Set();
      for (const p of body.pdocs) {
        const pid = id(p?.docId ?? p?.pid);
        if (!pid) fail('通过列表有无法识别的题号');
        confirmDomain(p, domain); solved.add(pid);
      }
      // The profile's nAccept counts practice ACs only; equality cannot certify coverage of hidden or contest ACs.
      // Positive pdocs prove the account can view problems. This covers visible problems only, on the native, unpaged profile.
      const visible = body.isSelfProfile === true && solved.size > 0 && !body.hasMore && !body.truncated && !(body.pageCount > 1) &&
        !(body.page > 1) && !(nat(body.udoc.nAccept) && +body.udoc.nAccept > solved.size);
      return { solved: [...solved], visible, selfVerified:body.isSelfProfile === true };
    }
    function problemStatus(body, pid, uid, domain) {
      if (!obj(body.pdoc) || id(body.pdoc.docId ?? body.pdoc.pid) !== pid || body.tdoc || (body.mode && body.mode !== 'normal') || !own(body, 'psdoc')) fail('题库未返回可核实的本人状态');
      confirmDomain(body.pdoc, domain);
      const ps = body.psdoc;
      if (ps === null) return { ac: false, ownerVerified:false };
      if (!obj(ps) || ps.uid != null && +ps.uid !== uid || ps.docId != null && id(ps.docId) !== pid) fail('个人题目状态与请求不符');
      confirmDomain(ps, domain);
      if (ps.status == null) {
        // A star-only document has no submissions. An unknown record must not become an unsolved problem.
        if (typeof ps.star === 'boolean' && !ps.rid) return { ac: false, ownerVerified:+ps.uid === uid };
        fail('个人题目状态缺少评测结果');
      }
      if (!nat(ps.status)) fail('无法识别个人评测结果');
      return { ac: +ps.status === 1, ownerVerified:+ps.uid === uid };
    }
    function verdict(cell) {
      if (cell == null || obj(cell) && !Object.keys(cell).length) return false;
      if (!obj(cell)) return null;
      if (cell.type === 'records' && Array.isArray(cell.raw)) {
        const parts = cell.raw.map(verdict);
        return parts.includes(true) ? true : parts.includes(null) ? null : false;
      }
      const raw = obj(cell.raw) ? cell.raw : {};
      const status = raw.status ?? cell.status;
      if (status != null) return nat(status) ? +status === 1 : null;
      const score = cell.score ?? raw.score;
      if (score != null && score !== '' && Number.isFinite(+score)) return +score === 100;
      // Homework displays penalized score / original score followed by elapsed time. Only original score indicates AC.
      const first = String(cell.value ?? '').trim().split(/\r?\n/)[0].trim();
      if (!first || /^[-–—]$/.test(first)) return cell.raw == null ? false : null;
      const m = /^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?$/.exec(first);
      return m ? +(m[2] ?? m[1]) === 100 : null;
    }
    function explicitAC(cell) {
      if (cell?.type === 'records' && Array.isArray(cell.raw)) return cell.raw.some(explicitAC);
      return +(cell?.raw?.status ?? cell?.status) === 1;
    }
    function boardPage(body, task, page, domain, uid) {
      const doc = body.tdoc;
      if (!obj(doc) || doc.rule && doc.rule !== 'homework' || doc.docId != null && id(doc.docId) !== task.id) fail('不是所请求作业的榜单');
      confirmDomain(doc, domain);
      if (!Array.isArray(body.rows) || !Array.isArray(body.rows[0])) fail('榜单缺少表头或不可见');
      const pages = pageInfo(body, page), header = body.rows[0], columns = [];
      const seen = new Set(), roster = new Set();
      for (const [i, cell] of header.entries()) if (cell?.type === 'problem') {
        const pid = id(cell.raw);
        if (!pid || seen.has(pid)) fail('榜单题号不完整或重复');
        seen.add(pid); const p = body.pdict?.[pid] || {}; confirmDomain(p, domain);
        if (p.docId != null && id(p.docId) !== pid) fail('榜单题号与题目详情不一致');
        // On a Hydro homework scoreboard (only here), nAccept counts distinct students with an actual AC in their journal.
        const official = doc.rule === 'homework' && nat(p.nAccept) ? +p.nAccept : null;
        columns.push({ i, pid, title: trim(p.title) || trim(cell.title) || trim(p.pid) || pid,
          official, public: p.hidden === false, hidden: p.hidden === true, counted: new Set(), self: false, exact: true });
      }
      if (Array.isArray(doc.pids) && (doc.pids.length !== seen.size || doc.pids.some(p => !seen.has(id(p))))) fail('榜单题目列不全');
      if (!columns.length && (!Array.isArray(doc.pids) || doc.pids.length)) fail('无法识别榜单题目列');
      const ui = header.findIndex(c => c?.type === 'user');
      if (columns.length && ui < 0) fail('榜单没有用户列');
      for (const row of body.rows.slice(1)) {
        if (!Array.isArray(row)) fail('榜单行格式无效');
        const raw = row[ui]?.raw, who = obj(raw) ? raw._id ?? raw.uid : raw;
        if (!nat(who) || +who === 0) fail('榜单行没有可核实的用户 ID');
        roster.add(+who);
        for (const col of columns) {
          const result = col.i >= row.length ? null : verdict(row[col.i]);
          if (result === null) col.exact = false;
          if (result === true) col.counted.add(+who);
          if (+who === uid && explicitAC(row[col.i])) col.self = true;
        }
      }
      const paged = pages > 1;
      return { pages, begin:date(doc.beginAt), roster: paged ? [...roster] : [], problems: columns.map(c => {
        if (!paged && c.official === null && !c.exact) fail('无法核实题目 '+c.pid+' 的通过人数');
        return { pid:c.pid, title:c.title, public:c.public, hidden:c.hidden, self:c.self, exact:c.exact, official:paged ? c.official : null,
          passed:c.official ?? c.counted.size, solvers:paged ? [...c.counted] : [] };
      }) };
    }
    return async function ({ domain, uid, start, end, threshold, read, pageLimit = 100, check = () => {}, onProgress = () => {} }) {
      uid = Number(uid); threshold = Number(threshold); pageLimit = Number(pageLimit);
      if (!domain || !Number.isSafeInteger(uid) || uid <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || start >= end ||
          !Number.isSafeInteger(pageLimit) || pageLimit < 1 || pageLimit > 1000 || !Number.isSafeInteger(threshold) || threshold < 1 || typeof read !== 'function') fail('请输入有效日期、正整数人数阈值，并登录当前域');
      const base = '/d/' + encodeURIComponent(domain), home = base + '/homework', warnings = [];
      const docs = new Map(), selfAC = new Set(), candidates = new Map(); let scanned = 0, matched = 0;
      const link = (p, tid) => base + '/p/' + encodeURIComponent(p) + (tid ? '?tid='+encodeURIComponent(tid) : '');
      const warn = (label, error) => {
        check(); if (error?.budget || error?.accountMismatch || error?.name === 'AbortError') throw error;
        warnings.push(label+'：'+(error?.message || '读取失败'));
      };
      const get = async (path, view, project) => { check(); const v = await read(path, view, project); check(); return v; };
      let listPages;
      for (let n = 1; ; n++) {
        try {
          if (n > pageLimit) fail('已达到 '+pageLimit+' 页上限，列表不完整');
          onProgress('正在读取作业列表，第 '+n+' 页');
          const page = await get(home+'?page='+n,'list-v1', b => {
            if (!Array.isArray(b?.tdocs)) fail('作业列表未返回');
            return { pages:pageInfo(b,n,true), docs:b.tdocs.map(d => homework(d,domain)) };
          });
          if (n === 1) listPages = page.pages;
          if (listPages !== page.pages) fail('分页总数在读取中发生变化');
          if (!page.docs.length) {
            if (listPages != null && (n < listPages || n > 1)) fail('分页中出现意外的空页');
            break;
          }
          if (listPages === 0) fail('非空列表的页数为 0');
          const before = docs.size;
          for (const d of page.docs) if (!docs.has(d.id)) docs.set(d.id,d);
          if (before === docs.size) fail('列表重复返回上一页');
          if (listPages != null && n >= listPages) break;
        } catch(e) { warn('作业列表第 '+n+' 页',e); break; }
      }
      for (let task of docs.values()) {
        const url = home + '/' + encodeURIComponent(task.id);
        try {
          // The homework detail GET may set startAt on a claimed timed assignment. Only inspect its scoreboard.
          if (task.begin !== null && (task.begin < start || task.begin >= end)) continue;
          if (task.begin !== null) matched++;
          onProgress('正在读取作业榜单：'+task.title);
          const first = await get(url+'/scoreboard','board-v1',b=>boardPage(b,task,1,domain,uid));
          if (task.begin === null) {
            if (first.begin === null) fail('榜单和列表均未返回开始时间');
            if (first.begin < start || first.begin >= end) continue;
            matched++;
          }
          const probs = first.problems.map(p=>({...p}));
          if (first.pages > 1) {
            const known = new Set(first.roster), counts = probs.map(p=>new Set(p.solvers));
            const stats = probs.map(p=>({values:[p.official], agrees:p.official===null ? p.exact : p.official===p.solvers.length}));
            let disjoint=true, maxPage=first.roster.length; const pageSizes=[maxPage];
            for (let n=2;n<=first.pages;n++) {
              if (n>pageLimit) fail('榜单超过 '+pageLimit+' 页上限');
              const pg=await get(url+'/scoreboard?page='+n,'board-v1',b=>boardPage(b,task,n,domain,uid));
              if (pg.pages!==first.pages || pg.problems.length!==probs.length || pg.problems.some((p,j)=>p.pid!==probs[j].pid)) fail('榜单分页发生变化');
              if (!pg.roster.some(u=>!known.has(u))) fail('榜单分页重复或为空');
              if (pg.roster.some(u=>known.has(u))) disjoint=false;
              pg.roster.forEach(u=>known.add(u)); maxPage=Math.max(maxPage,pg.roster.length); pageSizes.push(pg.roster.length);
              pg.problems.forEach((p,j)=>{ p.solvers.forEach(u=>counts[j].add(u)); probs[j].self ||= p.self;
                stats[j].values.push(p.official); stats[j].agrees &&= p.official===null ? p.exact : p.official===p.solvers.length;
              });
            }
            probs.forEach((p,j)=>{
              const {values,agrees}=stats[j], same=values[0]!==null && values.every(x=>x===values[0]);
              if (same && values[0]>maxPage && values[0]<=known.size) p.passed=values[0]; // necessarily a whole-board total
              else if (agrees) p.passed=counts[j].size; // confirmed per-page ACs with known user IDs
              else if (disjoint && !same && values.every(v=>v!==null) && values.every((v,i)=>v<=pageSizes[i])) p.passed=values.reduce((a,b)=>a+b,0);
              else fail('分页榜单无法核实题目 '+p.pid+' 的逐人状态');
            });
          }
          scanned++;
          for (const p of probs) {
            if (p.self) selfAC.add(p.pid);
            if (p.passed < threshold) continue;
            let found = candidates.get(p.pid);
            if (!found) { found={pid:p.pid,title:p.title,public:p.public,hidden:p.hidden,homeworks:[]}; candidates.set(p.pid,found); }
            found.public ||= p.public; found.hidden ||= p.hidden;
            found.homeworks.push({id:task.id,title:task.title,href:url,passed:p.passed});
          }
        } catch(e) { warn('作业 '+task.title,e); }
      }
      for (const pid of selfAC) candidates.delete(pid);
      let mine;
      if (candidates.size) {
        onProgress('正在核对当前账号在本域通过的题目');
        try { mine = await get(base+'/user/'+uid,'solved-v1',b=>profile(b,uid,domain)); }
        catch(e) { warn('个人通过列表',e); }
      }
      const seenAC = new Set(mine?.solved || []), rows = [];
      for (const [pid,p] of candidates) {
        if (seenAC.has(pid)) continue;
        let standalone = p.public;
        if (!mine?.visible || !p.public) {
          try { onProgress('正在核对本人题库状态：'+p.title);
            const ps = await get(link(pid),'problem-v1', b=>problemStatus(b,pid,uid,domain)); if (!mine?.selfVerified && !ps.ownerVerified) fail('缺少本人身份依据');
            if (ps.ac) continue; standalone = p.public || !p.hidden;
          } catch(e) { warn('跳过无法核实本人状态的题目 '+pid,e); continue; }
        }
        p.homeworks.sort((a,b)=>b.passed-a.passed || a.id.localeCompare(b.id));
        rows.push({pid,title:p.title,passed:p.homeworks[0].passed,href:link(pid,standalone ? null : p.homeworks[0].id),homeworks:p.homeworks});
      }
      check(); rows.sort((a,b)=>b.passed-a.passed || a.pid.localeCompare(b.pid, 'en', {numeric:true}));
      return {rows,scanned,matched,warnings,complete:!warnings.length};
    };
  })();
