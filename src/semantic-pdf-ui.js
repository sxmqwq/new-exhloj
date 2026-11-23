  const SEMANTIC_PDF_TTL = 10 * 60000, semanticPdfCache = new Map();
  const combinedPdfName = /试[卷题]|题面(?:合集|汇总)|题目集|problem[ _-]?set|(?:problems|statements|booklet)(?:[._ -]|$)/i;
  const pdfSearchContainsAttachment = text => /@\[\s*pdf\s*\]\s*\(|file:\/\/|(?:\/files?\/)[^\s<>]+|[?&](?:tid|X-Amz-Signature)=[\w-]+/i.test(text);

  function currentSearchPdfContext(pdoc) {
    const tdoc = current('tdoc') || {}, problemIds = [pdoc.docId, pdoc.pid, pdoc._id].filter(id => typeof id === 'string' || Number.isSafeInteger(id));
    const tid = String(new URL(location.href).searchParams.get('tid') || tdoc.docId || '');
    const kind = tdoc.rule === 'homework' ? 'homework' : tdoc.rule ? 'contest' : '';
    const title = String(pdoc.title || pdoc.pid || '');
    const index = Array.isArray(tdoc.pids) ? tdoc.pids.findIndex(pid => String(pid) === String(pdoc.docId)) : -1;
    const labels = titleLocation(), heading = labels.heading || (labels.header && $('h1, h2, .section__title', labels.header));
    const letter = index >= 0 && tdoc.pids.length > 1 ? alphabet(index) : /^(?:\s*)([A-Z])(?:[.．、:：]|\s)/.exec(heading?.textContent || '')?.[1] || '';
    return { href: location.href, domain: String(domainId()), problemIds, tid, kind, title, letter };
  }
  function pdfMemoKey(state, source) {
    return JSON.stringify([location.origin, state.context.owner, domainId(), state.context.key, state.pdfContext?.tid || '', source.url]);
  }
  function rememberSemanticPdf(key, data) {
    const cost = data.pages.flat().reduce((sum, l) => sum + l.length + 1, 0);
    semanticPdfCache.delete(key);
    semanticPdfCache.set(key, { time: Date.now(), cost, data });
    let total = [...semanticPdfCache.values()].reduce((n, item) => n + item.cost, 0);
    while (semanticPdfCache.size > 6 || total > 650000) {
      const id = semanticPdfCache.keys().next().value;
      total -= semanticPdfCache.get(id).cost; semanticPdfCache.delete(id);
    }
  }
  function pdfControlsState(state, busy) {
    const { cancel, choose, select, file, preview, apply } = state.pdfControls;
    cancel.hidden = !busy;
    choose.disabled = busy;
    select.disabled = busy;
    file.disabled = busy;
    apply.disabled = busy || !preview.value.trim();
  }
  function mountSearchPdfTools(state) {
    const area = el('section', { id:'exhloj-search-pdf', hidden:'', 'aria-label':'PDF 题面' });
    const status = el('p', { id:'exhloj-search-pdf-status', class:'exhloj-search-note', role:'status' });
    const cancel = el('button', { type:'button',class:'button exhloj-local-button', hidden:'' }, '停止读取 PDF');
    const choices = el('div', { class:'exhloj-search-pdf-controls', hidden:'' }), select = el('select', { 'aria-label':'选择题面 PDF' });
    const choose = el('button', { type:'button', class:'button exhloj-local-button' }, '读取所选 PDF');
    choices.append(select, choose);
    const pages = el('details', { id:'exhloj-search-pdf-pages', hidden:'' });
    const tools = el('div', { class:'exhloj-search-pdf-controls' });
    function pageNumber(name, label) {
      const wrapper = el('label', {}, label + ' '), field = el('input', { type:'number', name, min:1, step:1 });
      wrapper.append(field); tools.append(wrapper); return field;
    }
    const from = pageNumber('pdf-from', '起始页'), to = pageNumber('pdf-to', '结束页');
    const pageSummary = el('summary', {}, '选页并预览提取的文字');
    const pageNote = el('p', { class:'exhloj-search-note' });
    const preview = el('textarea', { id:'exhloj-search-pdf-preview', 'aria-label':'PDF 文字预览，可编辑', placeholder:'所选页的文字将显示在这里，也可删除同页的其他题目。' });
    const apply = el('button', { type:'button', class:'button exhloj-local-button', disabled:'' }, '用预览文字填入搜索框');
    const manual = el('details');
    const fileLabel = el('label', {}, '选择本地 PDF ');
    const file = el('input', { type:'file', accept:'.pdf,application/pdf' }); fileLabel.append(file);
    manual.append(el('summary', {}, '读取本地 PDF'), fileLabel);
    pages.append(pageSummary, tools, pageNote, preview, apply);
    area.append(status, cancel, choices, pages, manual);
    state.pdfControls = { area, status, cancel, choices, select, choose, pages, from, to, pageNote, preview, apply, file };
    cancel.addEventListener('click', () => state.pdfController?.abort(new Error('已停止读取 PDF，可直接粘贴题意。')));
    choose.addEventListener('click', () => task(() => {
      const source = state.pdfSources?.[+select.value]; if (source) return readSearchPdf(state, source);
    }));
    file.addEventListener('change', () => task(() => {
      const local = file.files?.[0]; file.value = '';
      if (local) return readSearchPdf(state, { file:local, name:local.name, shared:combinedPdfName.test(local.name) });
    }));
    const update = () => {
      if (state.pdfDocument) previewSearchPdf(state, state.pdfDocument);
    };
    from.addEventListener('input', update); to.addEventListener('input', update);
    preview.addEventListener('input', () => { apply.disabled = !preview.value.trim(); });
    apply.addEventListener('click', () => task(() => {
      assertSearchPanel(state);
      if (state.controller || state.pdfController) return;
      const text = preview.value.trim();
      if (!semanticPdfData.likelyText(text)) throw new Error('预览中没有足够的可读题意，请改用手动粘贴。');
      if (pdfSearchContainsAttachment(text)) throw new Error('请先从预览中移除附件地址。');
      const result = semanticPdfData.compact(text);
      setSearchText(state, result.text);
      const name = state.pdfDocument?.source.name;
      status.textContent = (name ? '题面来源：' + name + ' · 已使用预览文字。' : '已使用预览文字。') + (result.shortened ? '题面较长，已优先保留题意、输入输出和数据范围。' : '');
    }));
    return area;
  }
  function setSearchText(state, text) {
    state.input.value = text;
    state.automaticText = text;
    renderSearchResults(state);
  }
  function applySearchStatement(state, pdoc, force = false) {
    assertSearchPanel(state);
    if (hiddenContestSource()) return; // Follow the user's existing contest source visibility setting.
    const raw = markdownContent(pdoc?.content || '').trim();
    const ctx = pdoc && currentSearchPdfContext(pdoc), statement = semanticPdfData.markdown(raw, ctx?.title), controls = state.pdfControls;
    state.pdfController?.abort(); state.pdfController = null;
    pdfControlsState(state, false);
    const drafted = state.input.value !== state.automaticText;
    controls.area.hidden = !!statement.body && !statement.refs.length;
    controls.status.textContent = '';
    controls.choices.hidden = true; controls.pages.hidden = true;
    state.pdfContext = ctx; state.pdfSources = []; state.pdfDocument = null;
    if (statement.body) {
      if (!drafted || !statement.refs.length) setSearchText(state, statement.body);
      if (statement.refs.length) controls.status.textContent = '已填入网页题面。如需读取附件，可在下方选择。';
    } else if (!drafted) setSearchText(state, '');
    const sources = ctx ? semanticPdfData.urls(statement.refs, ctx) : [];
    state.pdfSources = sources;
    controls.select.replaceChildren(...sources.map((source, i) => el('option', { value:i }, source.name)));
    controls.choices.hidden = !sources.length || sources.length === 1 && !statement.body;
    if (!statement.body) {
      if (sources.length === 1) return readSearchPdf(state, sources[0], { force });
      controls.status.textContent = sources.length > 1 ? '本题包含多份 PDF，请选择题面文件。' :
        statement.refs.length ? '无法自动读取这个附件。请从原页下载后选择本地 PDF，或直接粘贴题意。' : '可粘贴题面，或选取本地 PDF 提取。';
    }
  }
  function previewSearchPdf(state, doc, range) {
    const { pages, from, to, preview, apply, pageNote } = state.pdfControls;
    const max = doc.pages.length;
    if (!max) return;
    if (range) {
      from.max = to.max = max;
      from.value = Math.min(max, Math.max(1, range.from || doc.source.page || 1));
      to.value = Math.max(+from.value, Math.min(max, Math.max(1, range.to || Math.min(+from.value + 1, max))));
      pages.hidden = false; pages.open = !!range.open;
    }
    const lo = +from.value, hi = +to.value;
    const valid = from.validity.valid && to.validity.valid && lo >= 1 && hi >= lo && hi <= max;
    preview.value = valid ? semanticPdfData.contentRows(doc.pages).filter(r => r.page >= lo && r.page <= hi).map(r => r.s).join('\n') : '';
    apply.disabled = !valid || !preview.value.trim();
    pageNote.textContent = (valid ? '预览 PDF 第 ' + lo + '–' + hi + ' 页。可编辑预览，删除同页的其他题目。' : '请输入有效的起止页码。') +
      (doc.truncated ? ' 只读取了前 ' + max + ' / ' + doc.total + ' 页；其余内容请从 PDF 手动复制。' : '');
  }
  async function readSearchPdf(state, source, { force = false } = {}) {
    assertSearchPanel(state);
    if (state.controller) return;
    state.pdfController?.abort();
    const controller = new AbortController(), signal = controller.signal, controls = state.pdfControls;
    state.pdfController = controller;
    const timer = setTimeout(() => controller.abort(new Error('读取 PDF 超时，请选取本地文件或手动粘贴题意。')), 30000);
    const before = state.input.value, revision = state.editRevision, untouched = before === state.automaticText;
    const check = () => { checkPdfRead(signal); assertSearchPanel(state); };
    const memo = source.url ? pdfMemoKey(state, source) : null;
    if (force && memo) semanticPdfCache.delete(memo);
    controls.status.textContent = '正在读取 ' + source.name + '…';
    controls.pages.hidden = true; state.pdfDocument = null; controls.preview.value = '';
    pdfControlsState(state, true);
    try {
      let data, reused = false;
      const cached = memo && semanticPdfCache.get(memo);
      if (cached && Date.now() - cached.time < SEMANTIC_PDF_TTL) { data = cached.data; reused = true; }
      else {
        if (source.file?.size > PDF_BYTES_LIMIT) throw new Error('PDF 超过 20 MiB，请从原文件复制需要的题意');
        const bytes = source.file ? new Uint8Array(await source.file.arrayBuffer()) : await downloadSemanticPdf(source.url, signal);
        check();
        data = await readSemanticPdfPages(bytes, signal, (n, total) => {
          check(); controls.status.textContent = '正在提取 ' + source.name + ' · 第 ' + n + ' / ' + total + ' 页';
        });
        check();
        if (memo && data.pages.some(p => semanticPdfData.likelyText(p.join('\n')))) rememberSemanticPdf(memo, data);
      }
      check();
      state.pdfDocument = { ...data, source };
      const picked = semanticPdfData.resolve(data.pages, { title:state.pdfContext?.title, letter:state.pdfContext?.letter,
        shared:source.shared || combinedPdfName.test(source.name), truncated:data.truncated });
      const label = '题面来源：' + source.name + (reused ? '（本页缓存）' : '') + ' · ';
      if (picked.kind === 'missing') {
        controls.status.textContent = label + '未提取到足够的可读文字。可能是扫描版或文字乱码，请粘贴题意。';
        if (data.pages.some(p => p.length)) previewSearchPdf(state, state.pdfDocument, { from:source.page || 1 });
        return;
      }
      if (picked.kind === 'choose') {
        controls.status.textContent = label + '不能确定当前题的范围，请选页并核对预览。';
        previewSearchPdf(state, state.pdfDocument, { from:picked.from || source.page || 1, to:picked.to, open:true });
        return;
      }
      const result = semanticPdfData.compact(picked.text);
      const canFill = untouched && revision === state.editRevision && before === state.input.value && !pdfSearchContainsAttachment(result.text);
      if (canFill) setSearchText(state, result.text);
      previewSearchPdf(state, state.pdfDocument, { from:picked.from, to:picked.to, open:!canFill });
      if (!canFill && !pdfSearchContainsAttachment(picked.text)) controls.preview.value = picked.text;
      controls.status.textContent = label + (picked.from === picked.to ? '第 ' + picked.from + ' 页。' : '第 ' + picked.from + '–' + picked.to + ' 页。') +
        (canFill ? (result.shortened ? '题面较长，已优先填入题意、输入输出和数据范围。' : '已填入题意，可编辑后再搜索。') : '已保留输入框内容，请核对预览。');
    } catch (error) {
      if (state === semanticPanel && state.pdfController === controller && state.body.isConnected && state.dialog.open && sameOriginContext(state.context)) {
        controls.status.textContent = '未能读取 ' + source.name + '：' + (error.message || String(error));
      }
    } finally {
      clearTimeout(timer);
      if (state.pdfController === controller) { state.pdfController = null; pdfControlsState(state, false); }
    }
  }
