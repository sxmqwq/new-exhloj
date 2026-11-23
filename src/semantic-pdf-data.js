  // Pure helpers for preparing the original-problem search input.
  const semanticPdfData = (() => {
    const norm = s => String(s || '').normalize('NFKC').trim();
    const key = s => norm(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const fileName = s => /\.pdf$/i.test(s) && !/[\\/\x00-\x1f\x7f]/.test(s) && s.length <= 250;
    const chars = s => (s.match(/[\p{L}\p{N}]/gu) || []).length;
    const pdfUrl = s => /\.pdf(?:[?#]|$)/i.test(s);
    const decode = s => { try { return decodeURIComponent(s); } catch { return ''; } };
    const letterHead = /^(?:(?:problem|task|题目)\s+([a-z]{1,2})\s*(?:[.、:)-]\s*|\s+)|([a-z])(?:[.、:)]\s*|\s+))/i;
    const bareLetter = /^(?:(?:problem|task|题目)\s+)?([A-Z])\s*[.、:)]?$/;
    const moreInfo = /^(?:查看|打开|下载|请(?:查看|打开|下载|阅读)|本题|本题题面|题目|题面|试题|题面下载|题目描述|样例(?:文件|数据)?|附件|PDF|statement|download|see|attached|the|file)(?:\s|[:：。、，()（）/]|见|在|请|附件|题面|题目|PDF|文件|下载|如下|中|内|$)/i;
    const chapter = /^(?:题目(?:背景|描述|大意)|问题描述|任务描述|题意(?:描述)?|描述|输入(?:格式|说明)?|输出(?:格式|说明)?|数据范围(?:与约定)?|(?:数据|测试点)规模|约束|数据限制|样例(?:输入|输出|说明|解释)?\s*\d*|子任务\s*\d*|提示|说明|background|(?:problem |task )?(?:description|statement)|input(?: format)?|output(?: format)?|(?:data )?constraints|(?:sample|example)(?: (?:input|output|explanation))?\s*\d*)$/i;
    const description = /^(?:题目(?:描述|大意)|问题描述|任务描述|题意(?:描述)?|描述|(?:problem |task )?(?:description|statement))$/i;
    const tableOfContents = /^(?:目\s*录|试题一览(?:表)?|题目一览(?:表)?|试题概览|table of contents|contents)$/i;
    const chapterName = s => norm(s).replace(/^[\s#【\[「*]+|[\s】\]」*:：]+$/g, '');
    const headings = title => {
      let name = norm(title).replace(/^#+\s*/, ''), letter = '';
      const m = letterHead.exec(name);
      if (m && name.slice(m[0].length).trim()) { letter = (m[1] || m[2]).toUpperCase(); name = name.slice(m[0].length); }
      const pair = /^(.*?)\s*\(([\w -]+)\)$/.exec(name);
      return { letter, names: [...new Set([key(name), ...(pair ? [key(pair[1]), key(pair[2])] : [])])].filter(x => x.length >= 2 || /\p{Script=Han}/u.test(x)) };
    };

    function markdown(text, title = '') {
      const refs = new Set(); let hasAttachment = false;
      const removeReference = (whole, lead, label, value) => {
        const url = value.replace(/^<|>$/g, '');
        const pdf = pdfUrl(url) || lead === '@' && /^pdf$/i.test(label.trim());
        if (pdf && !refs.has(url) && refs.size < 20) refs.add(url);
        if (pdf || /^file:\/\//i.test(url) || /(?:\/files?\/|\.(?:zip|rar|7z|in|out|ans|docx?|xlsx?)(?:[?#]|$))/i.test(url)) {
          hasAttachment = true; return '';
        }
        return whole;
      };
      // Keep prose and formulas. Ignore embeds inside fenced samples or inline code when discovering sources.
      const body = String(text || '').trim().split(/(^(?: {0,3})(?:```+|~~~+)[^\n]*\n[\s\S]*?(?:^ {0,3}(?:```+|~~~+)[^\n]*$|$))/m)
        .map((part, i) => i % 2 ? part : part.replace(/(`{1,3}[^\n]*?`{1,3})|([@!]?)(?:\[([^\]\n]*)\])\(\s*(<[^>\n]+>|(?:[^()\s]|\([^()\n]*\))+)(?:\s+["'][^\n]*?["'])?\s*\)/g,
          (whole, inline, lead, label, url) => inline ? whole : removeReference(whole, lead, label, url))
          .replace(/<(?:iframe|embed|object)\b[^>]*?(?:src|data)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>(?:\s*<\/(?:iframe|object)>)?/gi,
            (whole, a, b, c) => pdfUrl(a || b || c) ? removeReference(whole, '@', 'pdf', a || b || c) : whole))
        .join('').trim();
      if (!hasAttachment) return { body, refs: [...refs], hasAttachment };
      const target = headings(title).names;
      const useful = body.split(/\r?\n/).some(line => {
        const s = chapterName(line.replace(/^[-+*]\s+/, '').replace(/<\/?[a-z][^>]*>/gi, ''));
        return chars(s) > 0 && !target.includes(key(s)) && !headings(s).names.some(n => target.includes(n)) &&
          !chapter.test(s) && !(s.length <= 65 && moreInfo.test(s) && /附件|PDF|下载|文件|见|statement|attach|file|download|如下/i.test(s) && !/给定|求出?|如何|需要|方案|given|compute|find/i.test(s));
      });
      return { body: useful ? body : '', refs: [...refs], hasAttachment };
    }

    function urls(refs, { href, domain, problemIds, tid, kind }) {
      const base = new URL(href), allowed = new Map(), pagePath = base.pathname.split('/').filter(Boolean).map(decode);
      const docIds = new Set(problemIds.map(String));
      if (pagePath.at(-2) === 'p') docIds.add(pagePath.at(-1));
      const cleanTid = (tid || base.searchParams.get('tid') || '').toString();
      const validTid = /^[\w-]{1,100}$/.test(cleanTid) ? cleanTid : '';
      const domainPrefix = pagePath[0] === 'd' ? '/d/' + encodeURIComponent(domain) : '';
      const currentId = problemIds.find(x => /^\d+$/.test(String(x))) || pagePath.at(-1);
      for (const raw of refs) {
        try {
          const local = /^file:\/\/(.+)$/i.exec(raw), localName = local && decode(local[1]);
          if (local && (!fileName(localName) || !docIds.has(String(currentId)))) continue;
          const u = local ? new URL(domainPrefix + '/p/' + encodeURIComponent(currentId) + '/file/' + encodeURIComponent(localName), base) : new URL(raw, base);
          if (u.origin !== base.origin || u.username || u.password || !/^https?:$/.test(u.protocol)) continue;
          const parts = u.pathname.split('/').slice(1).map(decode);
          if (parts[0] === 'd') {
            if (parts[1] !== domain) continue;
            parts.splice(0, 2);
          } else if (domainPrefix) continue;
          const name = parts.at(-1);
          if (!fileName(name || '')) continue;
          const ownFile = parts.length === 4 && parts[0] === 'p' && docIds.has(parts[1]) && parts[2] === 'file';
          const shared = parts.length === 5 && (parts[0] === 'contest' || parts[0] === 'homework') && (!kind || kind === parts[0]) &&
            validTid && parts[1] === validTid && parts[2] === 'file' && parts[3] === 'public';
          if (!ownFile && !shared) continue;
          const givenTid = u.searchParams.getAll('tid'), type = u.searchParams.getAll('type');
          if (givenTid.length && (givenTid.length !== 1 || !validTid || givenTid[0] !== validTid) ||
              type.length && (type.length !== 1 || type[0] !== 'additional_file')) continue;
          u.search = '';
          if (ownFile && validTid) u.searchParams.set('tid', validTid);
          const page = /^#page=(\d+)(?:&|$)/i.exec(u.hash);
          u.hash = '';
          if (!allowed.has(u.href)) allowed.set(u.href, { url: u.href, name, shared: !!shared, page: page ? +page[1] : 0 });
          if (allowed.size === 10) break;
        } catch { /* Invalid or external attachments remain manual. */ }
      }
      return [...allowed.values()];
    }

    function pageText(items) {
      const lines = [];
      let line = '', last;
      function push() {
        const trimmed = line.replace(/[ \t\u00a0]+/g, ' ').trim();
        if (trimmed) lines.push(trimmed);
        line = ''; last = null;
      }
      for (const item of items) {
        if (typeof item.str !== 'string') continue;
        const [, , , , x, y] = item.transform || [];
        const height = Math.abs(item.height || item.transform?.[3] || 1);
        const str = item.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00ad\u200b\ufeff]/g, '').normalize('NFC');
        if (str.trim()) {
          if (last) {
            const size = Math.max(1, last.h, height);
            if (Number.isFinite(y) && Number.isFinite(last.y) && Math.abs(y - last.y) > size * 0.62 || x < last.x - size * 1.4) push();
            else if (!/\s$/.test(line) && !/^\s/.test(str) && x - last.right > size * 0.16) line += ' ';
          }
          line += str; last = { x, y, h: height, right: x + Math.abs(item.width || 0) };
        } else if (line && str && !line.endsWith(' ')) line += ' ';
        if (item.hasEOL) push();
      }
      push();
      return lines;
    }

    function contentRows(pages) {
      const edge = new Map();
      for (const lines of pages) {
        if (lines.length < 6) continue;
        const here = new Set();
        for (const s of [...lines.slice(0, 2), ...lines.slice(-2)]) {
          if (s.length <= 90 && !chapter.test(chapterName(s))) here.add(s);
        }
        for (const s of here) edge.set(s, 1 + (edge.get(s) || 0));
      }
      const result = [];
      pages.forEach((lines, i) => {
        lines.forEach((s, at) => {
          const onEdge = lines.length >= 5 && (at < 2 || at >= lines.length - 2);
          if (onEdge && /^(?:-\s*)?(?:第\s*)?\d+(?:\s*页)?(?:\s*(?:[/／]|of|共)\s*\d+)?(?:\s*-)?$/i.test(s) && (at === 0 || at === lines.length - 1)) return;
          if (onEdge && (edge.get(s) || 0) >= Math.max(2, Math.ceil(pages.length * 0.7)) && /模拟赛|联赛|竞赛|NOI|CSP|contest|copyright|共\s*\d+\s*页/i.test(s) && !letterHead.test(norm(s))) return;
          result.push({ s, page: i + 1 });
        });
      });
      return result;
    }
    function likelyText(input) {
      const count = chars(input), bad = (input.match(/[\ufffd\p{Co}]/gu) || []).length;
      const cjk = (input.match(/\p{Script=Han}/gu) || []).length;
      const words = (input.match(/\p{Script=Latin}{2,}/gu) || []).length;
      return count >= 14 && (cjk >= 7 || words >= 4) && bad <= Math.max(4, count * 0.08);
    }
    function resolve(pages, { title, letter, shared, truncated = false }) {
      const target = headings(title), want = letter || target.letter, rows = contentRows(pages);
      const all = rows.map(r => r.s).join('\n'), begins = [], descriptions = [];
      const isDesc = row => description.test(chapterName(row?.s || ''));
      rows.forEach((row, i) => { if (isDesc(row)) descriptions.push(i); });
      if (!likelyText(all)) return { kind: 'missing' };
      const toc = new Set(rows.filter(({s}) => tableOfContents.test(chapterName(s))).map(({page}) => page));
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], s = chapterName(row.s);
        if (s.length > 90 || chapter.test(s) || tableOfContents.test(s) || /[.…·]{2,}\s*\d*$/.test(s)) continue;
        const m = letterHead.exec(s), lonely = bareLetter.exec(s);
        let start = i, names = headings(s).names, code = m ? (m[1] || m[2]).toUpperCase() : '';
        if (lonely && (!m || !s.slice(m[0].length)) && rows[i+1]?.page === row.page && rows[i+1].s.length < 70) {
          code = lonely[1]; names = headings(rows[i+1].s).names;
          if (!chapter.test(chapterName(rows[i+1].s))) i++;
        } else if (!code && begins.at(-1)?.index >= i - 2 && begins.at(-1).code && /^\([\w -]+\)$/.test(s)) continue;
        const titleMatch = target.names.some(name => names.includes(name));
        const ahead = rows.slice(i + 1, i + 13);
        const nextDesc = ahead.findIndex(isDesc), nextHeader = ahead.findIndex(x => letterHead.test(chapterName(x.s)));
        const looksReady = nextDesc !== -1 && (nextHeader === -1 || nextHeader > nextDesc);
        if (toc.has(row.page)) continue;
        const aliasHead = /^.{2,60}\s*\([\w-]+\)$/.test(s);
        if (!titleMatch && !(looksReady && (code || aliasHead))) continue;
        // A repeated title in a running header usually has no description after it.
        if (!titleMatch && descriptions.length && !looksReady) continue;
        begins.push({ index: start, page: row.page, code, titleMatch, looksReady });
      }
      const multiple = new Set(begins.filter(b => b.looksReady).map(b => b.index)).size > 1 || descriptions.length > 1 || toc.size > 0;
      const matches = begins.filter(b => b.titleMatch && (!want || !b.code || b.code === want));
      const ranked = matches.sort((a,b) => ((b.looksReady?2:0) + (b.code && b.code===want?1:0)) - ((a.looksReady?2:0) + (a.code && a.code===want?1:0)));
      const chosen = ranked[0];
      if (!chosen) {
        if (shared || multiple || truncated || begins.length && target.names.length) return { kind:'choose' };
        return { kind:'text', text:all, from:1, to:pages.length };
      }
      const after = begins.filter(b => b.index > chosen.index && !b.titleMatch && b.looksReady).sort((a,b) => a.index - b.index)[0];
      const end = after?.index ?? rows.length;
      const endPage = rows[end-1]?.page ?? chosen.page;
      if (((multiple || shared || truncated) && !chosen.looksReady) ||
          descriptions.filter(i => i > chosen.index && i < end).length > 1 ||
          (ranked[1]?.looksReady && ranked[1].index < end && rows[ranked[1].index]?.page === chosen.page) ||
          (truncated && !after)) return { kind:'choose', from:chosen.page, to:after ? endPage : Math.min(chosen.page + 1, pages.length) };
      if ((shared || multiple) && !after && descriptions.some(i => i > chosen.index) && begins.some(b => b.index > chosen.index && !b.titleMatch)) return { kind:'choose', from:chosen.page };
      const text = rows.slice(chosen.index, end).map(r => r.s).join('\n').trim();
      return likelyText(text) ? { kind:'text', text, from:chosen.page, to:endPage } : { kind:'choose', from:chosen.page, to:endPage };
    }

    function compact(text, limit = 6800) {
      const size = s => new URLSearchParams({ q:s }).toString().length - 2;
      const raw = String(text || '').trim();
      if (raw.length <= 16000 && size(raw) <= limit) return { text:raw, shortened:false };
      const parts = [], lines = raw.split('\n'); let p = { name:'', data:[] };
      for (const s of lines) {
        const name = chapterName(s);
        if (chapter.test(name)) { parts.push(p); p = { name, data:[] }; }
        else p.data.push(s);
      }
      parts.push(p);
      const clip = (s, cap) => {
        if (size(s) <= cap) return s.trim();
        let used = 0, tail = '', best = 0;
        for (const ch of s) {
          used += size(ch);
          if (used > cap - 12) break;
          tail += ch;
          if (/[。！？.!?\n]/.test(ch) && used >= cap * 0.65) best = tail.length;
        }
        return (best ? tail.slice(0,best) : tail).trimEnd() + '…';
      };
      const given = parts.find(each => description.test(each.name) && each.data.some(Boolean));
      if (!given) return { text:clip(raw,limit), shortened:true };
      const groups = [[given,0.53]];
      for (const re of [/^输入|^input/i,/^输出|^output/i,/^(?:数据|约束|子任务|constraints)/i]) {
        const selected = parts.find(each => re.test(each.name) && each.data.some(Boolean));
        if (selected) groups.push([selected,0.17]);
      }
      const allow = limit - 100;
      const joined = groups.map(([each, frac], i) => clip(each.name + '\n' + each.data.join('\n').trim(), Math.floor(allow * (frac + (i === 0 ? (4-groups.length)*0.15 : 0))))).join('\n\n');
      return { text:joined, shortened:true };
    }

    return { markdown, urls, pageText, contentRows, resolve, likelyText, compact };
  })();
