const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixturePdf, memoryIntro, memoryPages, combinedPages } = require('./fixtures/pdf-text.cjs');
const root = path.resolve(__dirname, '..');
const source = ['vendor/pdf-text-engine.js','src/semantic-pdf-data.js','src/semantic-pdf-engine.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
const { helpers, read, download } = new Function(source + '\nreturn { helpers:semanticPdfData, read:readSemanticPdfPages, download:downloadSemanticPdf };')();
const domain = 'pnoi', origin = 'https://oj.hailiangedu.com', tid = '6af000000000000000000000';
const page = { href:origin+'/d/'+domain+'/p/5067?tid='+tid, domain, tid, kind:'contest', problemIds:[5067,'S10'] };
const doc = origin + '/d/'+domain+'/p/5067/file/memory.pdf?tid='+tid;
const title = { title:'记忆 （memory）', letter:'D' };

(async () => {
  const markup = '[本题样例文件](./5067/file/memory.zip?tid=' + tid + ')\n\n@[pdf](./5067/file/memory.pdf?tid=' + tid + ')';
  const m = helpers.markdown(markup, title.title);
  assert.equal(m.body,''); assert.deepEqual(helpers.urls(m.refs,page), [{url:doc,name:'memory.pdf',shared:false,page:0}]);
  assert.equal(helpers.markdown('# D. 记忆（memory）\n题目描述见附件。\n' + markup, title.title).body, '');
  const plain = '给定两个整数，输出 $a+b$。';
  assert.equal(helpers.markdown(plain + '\n\n' + markup, title.title).body, plain);
  assert.equal(helpers.markdown('给定两个字符串。\n\`\`\`txt\n@[pdf](fake.pdf)\n\`\`\`').refs.length, 0);
  assert.deepEqual(helpers.urls(['file://memory.pdf','#page=2', './5067/file/memory.pdf#page=3'],page).map(x=>x.url),[doc]);
  assert.equal(helpers.urls(['./5067/file/memory.pdf#page=3'],page)[0].page,3);
  const fileRef = 'file://' + encodeURIComponent('记忆 (正式).pdf');
  assert.equal(helpers.urls([fileRef],page)[0].name,'记忆 (正式).pdf');
  assert.equal(helpers.markdown('@[pdf](<file://记忆 (正式).pdf>)').refs[0],'file://记忆 (正式).pdf');
  assert.equal(helpers.markdown('<iframe src="./5067/file/memory.pdf"></iframe>').refs.length,1);
  assert.equal(helpers.urls(['/d/pnoi/contest/'+tid+'/file/public/' + encodeURIComponent('整场试题.pdf')],page)[0].shared,true);
  assert.deepEqual(helpers.urls([
    'https://another.example/d/pnoi/p/5067/file/statement.pdf','/user/logout?next=remember.pdf',
    '/p/5067/file/statement.pdf', '/d/private/p/5067/file/statement.pdf','./9001/file/statement.pdf',
    './5067/file/memory.pdf?tid=offscope','./5067/file/memory.pdf?type=testdata','./5067/file/dev%2Fmemory.pdf',
    '../contest/other/file/public/statement.pdf','javascript:ignore.pdf',
  ],page),[]);
  console.log('PASS PDF: Markdown attachment discovery, contest address, and restricted native file routes');

  const a = helpers.resolve(memoryPages,title);
  assert.equal(a.kind,'text'); assert.match(a.text,/不同数的个数/); assert.equal(a.to,2);
  const b = helpers.resolve(combinedPages,{ ...title, shared:true });
  assert.equal(b.kind,'text'); assert.equal(b.from,3); assert.equal(b.to,4);
  assert.match(b.text,/每次询问的结果/); assert.doesNotMatch(b.text,/路径（path）|方块（square）|目录/);
  assert.equal(helpers.resolve(combinedPages,{title:'无关',letter:'D',shared:true}).kind,'choose');
  assert.equal(helpers.resolve(memoryPages.slice(0,1),{...title,truncated:true}).kind,'choose');
  assert.equal(helpers.resolve([['... \ufffd'.repeat(30)]],title).kind,'missing');
  assert.equal(helpers.resolve([['NOIP', 'D.', '记 忆', '（memory）', '题目描述',memoryIntro]],title).kind,'text');
  assert.equal(helpers.resolve([['D. 记忆（memory）','【题目描述】',memoryIntro,'难以定位的他题','【题目描述】',memoryIntro]],{...title,shared:true}).kind,'choose');
  const long = helpers.compact(['题目描述',memoryIntro.repeat(65), '输入格式','第一行包含整数。', '输出格式','输出整数。','数据范围','∣a∣ ≤ 10⁹'].join('\n'));
  assert.equal(long.shortened,true); assert.match(long.text,/数据范围[\s\S]*10⁹/);
  assert.ok(new URLSearchParams({q:long.text}).toString().length < 7500);
  assert.equal(helpers.pageText([{str:'令 $n²$',transform:[1,0,0,10,0,50],width:30},{str:'为给定的数。',transform:[1,0,0,10,30,50],hasEOL:true}])[0],'令 $n²$为给定的数。');
  console.log('PASS PDF: single statement, booklet boundaries and TOC, manual fallback and compact query');

  const abort = new AbortController(), actual = await read(Uint8Array.from(fixturePdf(combinedPages)),abort.signal);
  const picked = helpers.resolve(actual.pages,{...title,shared:true});
  assert.equal(actual.total,4); assert.equal(picked.kind,'text',JSON.stringify(actual.pages));
  assert.ok(picked.text.replace(/\s/g,'').includes(memoryIntro.replace(/\s/g,'')));
  assert.doesNotMatch(picked.text,/路径|棋盘/);
  assert.deepEqual((await read(Uint8Array.from(fixturePdf([[]])),abort.signal)).pages,[[]]);
  await assert.rejects(() => read(new TextEncoder().encode('<html>login</html>'),abort.signal),/不是 PDF/);
  const cancelled = new AbortController();
  const work = read(Uint8Array.from(fixturePdf(combinedPages)),cancelled.signal,()=>cancelled.abort(new Error('测试取消')));
  await assert.rejects(work,/测试取消/);

  const oldFetch = globalThis.fetch;
  globalThis.location={origin};
  try {
    globalThis.fetch = async (_url, opts) => {
      assert.equal(opts.credentials,'same-origin'); assert.equal(opts.referrerPolicy,'no-referrer');
      return new Response('denied',{status:403});
    };
    await assert.rejects(()=>download(doc,abort.signal),/没有附件访问权限/);
    await assert.rejects(()=>download('https://another.example/memory.pdf',abort.signal),/当前 OJ/);
  } finally { globalThis.fetch=oldFetch; delete globalThis.location; }
  console.log('PASS PDF: real Chinese PDF extraction, empty text layer, cancellation and inaccessible attachment');
})().catch(error => { console.error(error); process.exitCode = 1; });
