  // This module is included inside the userscript IIFE by scripts/build.cjs.
  function openHomeworkPlanner() {
    syncPageContext();
    if (!settings.homeworkPlanner || pageName() !== 'homework_main') throw workError('请在作业首页启用并打开补题计划');
    const body = modal('作业补题计划', 'contest'), dialog = body.closest('dialog');
    dialog.dataset.exhHomeworkPlan = '1';
    const domain = String(domainId()), uid = +user()._id, epoch = routeEpoch, address = location.href;
    if (!Number.isSafeInteger(uid) || uid <= 0) { body.append(el('p', {}, '请先登录 OJ，再查找自己尚未通过的题目。')); return; }
    const key = 'exhloj.local.homework-plan.last.v1:' + JSON.stringify([location.origin, domain, uid]);
    const today = new Date(), month = new Date(today); month.setDate(month.getDate() - 29);
    const defaults = { from: localDateInput(month), to: localDateInput(today), threshold: 3 };
    const previous = stored(key, null);
    let saved = previous?.schema === 1 && previous.uid === uid && previous.domain === domain &&
      previous.origin === location.origin && previous.filters && Number.isFinite(previous.time) &&
      Array.isArray(previous.rows) && previous.rows.every(r => r && Array.isArray(r.homeworks)) ? previous : null;
    const form = el('form', { id: 'exhloj-homework-plan-form' }), filters = saved?.filters || defaults;
    body.append(el('p', {}, '按作业开始日期查找，包含首尾两天。只列出你在本域尚未通过、且在至少一份作业中达到通过人数的题目。'));
    for (const [name, label, type] of [['from', '开始日期', 'date'], ['to', '结束日期', 'date'], ['threshold', '至少通过人数', 'number']]) {
      const wrap = el('label', {}, label + ' ');
      wrap.append(el('input', { name, type, value: filters[name], required: '', ...(name === 'threshold' ? { min: 1, step: 1 } : {}) })); form.append(wrap);
    }
    const start = el('button', { id: 'exhloj-homework-plan-scan', type: 'submit', class: 'button exhloj-local-button' }, '查找补题');
    const reset = el('button', { id: 'exhloj-homework-plan-reset', type: 'button', class: 'button exhloj-local-button' }, '重置请求缓存');
    const results = el('div', { id: 'exhloj-homework-plan-results', class: 'exhloj-work-results' });
    form.append(start, reset); body.append(form, el('p', {}, '同一账号、同一域的查询结果会复用 ' +
      (HOMEWORK_PLAN_CACHE_TTL / 60000) + ' 分钟。重置后，下次查找会重新读取；上次完整计划仍保留。'));
    const state = workStates.planner; if (!state.running) Object.assign(state, { status: '', message: '', errors: [], job: null });
    workProgress(body, 'planner'); showWorkErrors(state); body.append(results);
    const cancel = $('[data-exh-action="work-cancel"]', body); cancel.disabled = true;
    let generation = 0, activeJob;
    function assertPage() {
      if (!dialog.open || !body.isConnected || epoch !== routeEpoch || address !== location.href || pageName() !== 'homework_main' ||
          uid !== +user()._id || domain !== String(domainId()) || !settings.homeworkPlanner) throw workError('页面、账号或域已变化，请重新打开补题计划');
    }
    function resultLink(label, href, kind) {
      // Only link to the two local routes the data module emits, including when restoring saved results.
      try {
        const url = new URL(href, location.origin);
        if (url.origin === location.origin && url.pathname.startsWith('/d/' + seg(domain) + '/' + kind + '/'))
          return el('a', { href: url.pathname + url.search, target: '_blank', rel: 'noopener noreferrer' }, label);
      } catch { /* Render unreadable links as plain text. */ }
      return el('span', {}, label);
    }
    function render(record, mode) {
      results.replaceChildren();
      if (!record) { results.append(el('p', {}, '还没有保存的补题计划。')); return; }
      const f = record.filters, cached = mode === 'saved', partial = mode === 'partial';
      const title = cached ? '上次保存的计划' : partial ? '部分结果（未保存）' : '本次补题计划';
      results.append(el('h3', {}, title + ' · ' + record.rows.length + ' 道题'),
        el('p', {}, f.from + ' 至 ' + f.to + ' · 至少 ' + f.threshold + ' 人通过 · 已读取 ' + record.scanned + '/' + record.matched +
          ' 份匹配作业的榜单 · ' + new Date(record.time).toLocaleString()));
      if (partial) results.append(el('p', {}, '有数据未能核实，只展示已确认的题目。' + (saved ? '上次完整计划仍保留。' : '')));
      if (!record.rows.length) { results.append(el('p', {}, partial ? '已核实的数据中没有符合条件的题目。' : '此范围内没有符合条件的题目。')); return; }
      const table = el('table'), head = el('thead'), th = el('tr'), list = el('tbody');
      for (const label of ['题目', '最多通过人数', '来源作业（通过人数）']) th.append(el('th', { scope: 'col' }, label));
      head.append(th); table.append(head, list); results.append(table);
      let at = 0; const more = el('button', { type: 'button', class: 'button exhloj-local-button' });
      function appendPage() {
        const fragment = document.createDocumentFragment(), end = Math.min(at + 100, record.rows.length);
        for (; at < end; at++) {
          const row = record.rows[at], tr = el('tr'), problem = el('td'), source = el('td');
          const pid = String(row.pid), title = String(row.title || pid);
          problem.append(resultLink(title === pid || title.startsWith(pid + ' ') ? title : pid + ' · ' + title, row.href, 'p'));
          for (const [i, hw] of row.homeworks.entries()) {
            if (!hw) continue;
            if (i) source.append('、'); source.append(resultLink(String(hw.title || hw.id), hw.href, 'homework'), '（' + hw.passed + '）');
          }
          tr.append(problem, el('td', {}, row.passed), source); fragment.append(tr);
        }
        list.append(fragment); more.hidden = at >= record.rows.length;
        more.textContent = '显示更多（已显示 ' + at + '/' + record.rows.length + '）';
      }
      more.addEventListener('click', appendPage); results.append(more); appendPage();
    }
    render(saved, 'saved');
    const busy = value => { start.disabled = value; cancel.disabled = !value; for (const input of $$('input', form)) input.disabled = value; };
    dialog.addEventListener('close', () => { generation++; activeJob?.controller.abort(); }, { once: true });
    reset.addEventListener('click', () => task(async () => {
      assertPage(); generation++; activeJob?.controller.abort();
      resetHomeworkPlanCache(domain); render(saved, 'saved');
      if (!activeJob) Object.assign(state, { job: null, status: '就绪', errors: [], message: '已重置本域当前账号的请求缓存。' });
      updateWorkProgress('planner'); showWorkErrors(state); notify('已重置补题计划缓存，可按当前条件重新查找');
    }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      task(async () => {
        assertPage(); if (activeJob || workJobs.has('planner')) throw workError('补题查找仍在结束，请稍后再试');
        const from = form.elements.from.value, to = form.elements.to.value, threshold = Number(form.elements.threshold.value);
        const first = new Date(from + 'T00:00:00'), last = new Date(to + 'T00:00:00');
        if (localDateInput(first) !== from || localDateInput(last) !== to || first > last) throw workError('请选择有效的起止日期，结束日期不能早于开始日期');
        if (!Number.isSafeInteger(threshold) || threshold < 1) throw workError('通过人数须为正整数');
        last.setDate(last.getDate() + 1);
        const token = ++generation, revision = homeworkPlanCacheRevision(domain);
        busy(true); render(saved, 'saved');
        try { await runWork('planner', async (job, work) => {
          activeJob = job;
          const check = () => { checkJob(job); assertPage(); if (generation !== token) throw workError('本次查找已取消'); };
          const onProgress = message => { check(); work.message = message; updateWorkProgress('planner'); };
          const plan = await scanHomeworkPlan({ domain, uid, start: +first, end: +last, threshold, pageLimit: settings.helperPageLimit, check, onProgress,
            read: (path, view, project) => { check(); return homeworkPlanRead(job, domain, path, view, project); } });
          check(); if (homeworkPlanCacheRevision(domain) !== revision) throw workError('补题缓存已重置，请重新查找');
          const record = { schema: 1, revision, domain, uid, origin: location.origin, time: Date.now(), filters: { from, to, threshold },
            rows: plan.rows, scanned: plan.scanned, matched: plan.matched };
          if (plan.complete) {
            try {
              if (new Blob([JSON.stringify(record)]).size > LIMIT) throw new Error('too large');
              save(key, record); saved = record; work.message = '已保存这次完整的补题计划。';
            } catch { work.message = '本次结果可在这里查看，但未能写入本地存储。'; }
          } else { work.status = '完成，部分结果'; work.message = '未核实的数据不会加入计划。'; }
          work.errors.push(...plan.warnings); render(record, plan.complete ? 'fresh' : 'partial');
        }); } finally {
          activeJob = null; busy(false);
          if (token !== generation && state.root === body && dialog.open) {
            Object.assign(state, { job: null, status: '就绪', errors: [], message: '已重置本域当前账号的请求缓存。' });
            updateWorkProgress('planner'); showWorkErrors(state);
          }
        }
      });
    });
  }
