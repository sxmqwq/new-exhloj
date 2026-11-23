  const PDF_BYTES_LIMIT = 20 * 1024 * 1024, PDF_AUTO_PAGES = 60;
  const pdfReadAbort = signal => signal.reason || new Error('已停止读取 PDF');
  const checkPdfRead = signal => { if (signal.aborted) throw pdfReadAbort(signal); };

  async function downloadSemanticPdf(url, signal) {
    if (new URL(url).origin !== location.origin) throw new Error('只自动读取当前 OJ 的题面附件');
    let response;
    try {
      // Hydro authorizes the attachment then redirects to storage. Never attach OJ cookies to a different origin.
      response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer', signal });
    } catch (error) {
      checkPdfRead(signal);
      throw new Error('浏览器无法读取题面附件。可在原页下载，再选取本地 PDF');
    }
    if (response.status === 401 || response.status === 403) throw new Error('当前账号没有附件访问权限，请在 OJ 确认登录状态');
    if (!response.ok) throw new Error('题面附件返回 HTTP ' + response.status);
    if (Number(response.headers.get('content-length')) > PDF_BYTES_LIMIT) throw new Error('PDF 超过 20 MiB，请从原页复制需要的题意');
    if (!response.body) throw new Error('附件未返回内容');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > PDF_BYTES_LIMIT) throw new Error('PDF 超过 20 MiB，请从原页复制需要的题意');
        chunks.push(value);
      }
    } finally { void reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }

  async function localSemanticPdfPort(engine, signal) {
    checkPdfRead(signal);
    if (typeof Worker === 'function') {
      let worker, url;
      try {
        url = URL.createObjectURL(new Blob([engine.startExhlojPdfWorker.toString(), '\nstartExhlojPdfWorker();\n'], { type: 'text/javascript' }));
        worker = new Worker(url, { name: 'Extend HLOJ PDF' });
        await new Promise((resolve, reject) => {
          const handlers = new AbortController();
          const done = (fn, value) => {
            clearTimeout(timer); handlers.abort(); fn(value);
          };
          const timer = setTimeout(() => done(reject, new Error('PDF worker did not start')), 2500);
          worker.addEventListener('message', event => { if (event.data?.action === 'ready') done(resolve); }, { signal: handlers.signal });
          worker.addEventListener('error', event => { event.preventDefault(); done(reject, new Error('PDF worker unavailable')); }, { signal: handlers.signal, once:true });
          signal.addEventListener('abort', () => done(reject, pdfReadAbort(signal)), { signal: handlers.signal, once:true });
        });
        checkPdfRead(signal);
        return { port:worker, close:() => worker.terminate() };
      } catch {
        worker?.terminate(); checkPdfRead(signal);
      } finally { if (url) URL.revokeObjectURL(url); }
    }
    // Some OJs disallow blob workers in CSP. A MessageChannel hosts the same local parser without evaluating code from a URL.
    const channel = new MessageChannel();
    const handler = engine.startExhlojPdfWorker();
    handler.initializeFromPort(channel.port1);
    channel.port1.start(); channel.port2.start();
    return { port:channel.port2, close:() => { channel.port1.close(); channel.port2.close(); } };
  }

  async function readSemanticPdfPages(bytes, signal, onPage = () => {}) {
    checkPdfRead(signal);
    if (bytes.byteLength > PDF_BYTES_LIMIT) throw new Error('PDF 超过 20 MiB，请从原页复制需要的题意');
    if (!new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) {
      throw new Error('返回的附件不是 PDF（可能是登录页），请确认访问权限或选择本地 PDF');
    }
    const engine = getExhlojPdfEngine(), local = await localSemanticPdfPort(engine, signal);
    let worker, loading, onAbort;
    try {
      worker = new engine.PDFWorker({ port: local.port, verbosity: 0 });
      loading = engine.getDocument({
        data:bytes, worker, useWorkerFetch:false, BinaryDataFactory:engine.LocalPdfData, useWasm:false,
        disableWorkerRendering:true, disableFontFace:true, useSystemFonts:true, enableXfa:false, verbosity:0,
      });
      const abort = new Promise((_, reject) => {
        onAbort = () => reject(pdfReadAbort(signal));
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once:true });
      });
      const readPages = async () => {
        const pdf = await loading.promise, pages = [], end = Math.min(pdf.numPages, PDF_AUTO_PAGES);
        let bounded = false, collected = 0;
        for (let n = 1; n <= end; n++) {
          checkPdfRead(signal); onPage(n, end);
          const page = await pdf.getPage(n), reader = page.streamTextContent().getReader(), items = [];
          let count = 0;
          try {
            for (;;) {
              const { value, done } = await reader.read(); if (done) break;
              checkPdfRead(signal);
              for (const item of value.items) {
                if (typeof item.str !== 'string') continue;
                count += item.str.length;
                if (count > 65000 || items.length >= 24000) { bounded = true; break; }
                items.push(item);
              }
              if (bounded) break;
            }
          } finally {
            void reader.cancel().catch(() => {}); page.cleanup();
          }
          const lines = semanticPdfData.pageText(items); pages.push(lines);
          for (const s of lines) collected += s.length + 1;
          if (collected > 350000 || bounded) break;
        }
        return { pages, total:pdf.numPages, truncated:bounded || pages.length < pdf.numPages };
      };
      return await Promise.race([readPages(), abort]);
    } catch (error) {
      if (signal.aborted) throw pdfReadAbort(signal);
      if (error.name === 'PasswordException') throw new Error('PDF 已加密，请打开原文件后复制题意');
      if (error.name === 'InvalidPDFException') throw new Error('PDF 无法解析，可能已损坏或尚未下载完整');
      throw error;
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      const dispose = () => { worker?.destroy(); local.close(); };
      if (!loading) dispose();
      else {
        // Destroy the loading task before closing its port; don't wait forever for a failed worker.
        let freed = false;
        const free = () => { if (!freed) { freed = true; clearTimeout(timer); dispose(); } };
        const timer = setTimeout(free, signal.aborted ? 0 : 350);
        const cleaned = loading.destroy().catch(() => {}).finally(free);
        if (!signal.aborted) await Promise.race([cleaned, new Promise(resolve => setTimeout(resolve, 350))]);
      }
    }
  }
