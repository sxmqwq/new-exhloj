// Exercise the installed userscript (including persistence and page tools), with no live OJ calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const userscript = fs.readFileSync(path.resolve(__dirname, '../dist/exhloj.user.js'), 'utf8');
const origin = 'https://oj.hailiangedu.com';
const home = '/d/test/homework';
const hid=n=>String(n).padStart(24,'0'), boardURL=n=>home+'/'+hid(n)+'/scoreboard';
const projects = [
  { docId:'100', title:'作业甲', beginAt:'2026-11-16T16:00:00.000Z', pids:[10,11,12,13] }, // 17th 00:00 locally
  { docId:'101', title:'作业乙', beginAt:'2026-11-18T15:59:59.000Z', pids:[10,11] }, // 18th 23:59:59
  { docId:'102', title:'范围外作业', beginAt:'2026-11-18T16:00:00.000Z', pids:[14] },
].map(doc => ({ ...doc,docId:hid(doc.docId),domainId:'test',rule:'homework',endAt:'2026-11-20T10:00:00.000Z' }));
const labels = { 10:'两份作业的同一题', 11:'两份作业各仅一人通过', 12:'只在平时通过的题', 13:'达到人数门槛的另一道题', 14:'范围外的题' };
const results = {
  100:[[7,100,100,100,100],[8,100,60,100,100],[9,100,0,50,50]],
  101:[[7,100,100],[8,100,50]],
  102:[[7,100],[8,100]],
};
function board(doc) {
  const scores=results[+doc.docId], pdict=Object.fromEntries(doc.pids.map((id,i)=>[id, {
    docId:id,pid:'P'+id,domainId:doc.domainId,title:labels[id],hidden:false,nAccept:scores.filter(row=>row[i+1]===100).length,
  }]));
  const rows=[
    [{type:'user',value:'用户'},...doc.pids.map(id=>({type:'problem',raw:id,value:'P'+id}))],
    ...scores.map(([uid,...s])=>[{type:'user',raw:uid,value:'user'+uid},...s.map((score,i)=>({type:'record',score,
      raw:'6439bb339a000000000000'+String(uid+i).padStart(2,'0'),value:String(score),status:score===100?1:2}))]),
  ];
  return {tdoc:doc,pdict,rows};
}
function documentHTML() {return '<!doctype html><html data-page="homework_main"><head><meta charset="utf-8"><link rel="icon" href="data:,"></head><body class="page--homework_main">' +
  '<main class="main"><div class="row"><div class="medium-9 columns"><section class="section"><div class="section__header"><h1 class="section__title">作业</h1></div><div class="section__body"></div></section></div><aside class="medium-3 columns"></aside></div></main></body></html>';}

(async()=>{
  const browser=await chromium.launch({...(process.env.EXHLOJ_CHROME?{executablePath:process.env.EXHLOJ_CHROME}:{}),headless:true,args:['--no-sandbox']});
  try {
    const context=await browser.newContext({timezoneId:'Asia/Shanghai'}), calls=[], errors=[], unexpected=[];
    let uid=42, failBoard='',holdBoard=null;
    await context.addInitScript(()=>{
      if(location.origin!=='https://oj.hailiangedu.com')return;
      window.unsafeWindow=window;
      window.UiContext={domain:{_id:'test'}};
      window.UserContext={_id:Number(sessionStorage.getItem('fixture-account')||42)};
      // Model the userscript manager: its storage persists across reloads AND login changes.
      window.GM_getValue=(key,fallback)=>{
        const v=localStorage.getItem('fixture-gm:'+key);
        return v===null ? key==='exhloj.coreui.settings.v1' ? {helperDelay:100,remote:false,autoAttend:false} : fallback : JSON.parse(v);
      };
      window.GM_setValue=(key,val)=>localStorage.setItem('fixture-gm:'+key,JSON.stringify(val));
      window.GM_registerMenuCommand=()=>{};
      window.GM_xmlhttpRequest=()=>{throw Error('Unexpected cross-origin request');};
    });
    await context.route('**/*',async route=>{
      const req=route.request(), u=new URL(req.url());
      if(req.method()!=='GET'||u.origin!==origin){unexpected.push(req.method()+' '+req.url());return route.abort();}
      if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:documentHTML()});
      const url=u.pathname+u.search;calls.push({uid,url});
      const send=(obj,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(obj)});
      if(u.pathname===home){
        const page=Number(u.searchParams.get('page')||1);
        return send({page,tpcount:2,tdocs:page===1?[projects[2],projects[1]]:page===2?[projects[0]]:[]});
      }
      const entry=u.pathname.match(/^\/d\/test\/homework\/(\d+)(\/scoreboard)?$/);
      if(entry){
        const doc=projects.find(each=>each.docId===entry[1]);if(!doc){unexpected.push(url);return send({},404);}
        if(entry[2]&&holdBoard&&holdBoard.id===doc.docId){
          const held=holdBoard;holdBoard=null;await held.promise;
          if(req.failure())return;
          return send(board(doc)).catch(err=>{if(!req.failure())throw err;});
        }
        if(entry[2]&&failBoard===doc.docId)return send({error:{name:'PermissionError',message:'成绩表无权限'}},403);
        return send(entry[2]?board(doc):{tdoc:doc,pdict:board(doc).pdict});
      }
      const user=u.pathname.match(/^\/d\/test\/user\/(\d+)\/?$/);
      const accepted=uid===42?12:13;
      if(user&&+user[1]===uid) return send({udoc:{_id:uid,nAccept:1},isSelfProfile:true,pdocs:[{domainId:'test',docId:accepted,pid:'P'+accepted,title:labels[accepted]}]});
      const problem=u.pathname.match(/^\/d\/test\/p\/(?:P)?(\d+)\/?$/);
      if(problem){const id=+problem[1];return send({pdoc:{domainId:'test',docId:id,pid:'P'+id,title:labels[id],hidden:false},
        psdoc:id===accepted?{domainId:'test',docId:id,uid,status:1}:null});}
      unexpected.push(url);return send({error:'Unexpected fixture route'},404);
    });
    const page=await context.newPage();
    page.setDefaultTimeout(9000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',dialog=>dialog.accept());
    const open=async()=>{
      await page.locator('#exhloj-title-toggle').click();
      await page.locator('#exhloj-title-popup [data-exh-action="homework-plan-open"]').click();
      await page.locator('#exhloj-homework-plan-form').waitFor();
    };
    const navigate=async()=>{
      await page.goto(origin+home);await page.addScriptTag({content:userscript});await open();
    };
    const form=page.locator('#exhloj-homework-plan-form'), box=page.locator('#exhloj-homework-plan-results');
    const fields=async(threshold=2)=>{
      await form.locator('[name=from]').fill('2026-11-17');await form.locator('[name=to]').fill('2026-11-18');
      await form.locator('[name=threshold]').fill(String(threshold));
    };
    const scan=async(threshold=2)=>{
      await fields(threshold);await page.locator('#exhloj-homework-plan-scan').click();
      await page.waitForFunction(()=>{
        const p=document.querySelector('[data-work-progress="planner"]');
        return !!p && /^(已完成|部分完成|完成|未完成)/.test(p.textContent);
      });
    };
    const problemRows=box.locator('tbody tr');
    const inPlan=async(id)=>problemRows.filter({hasText:labels[id]}).count();
    const expectRows=async(ids)=>{
      for(const id of [10,11,12,13,14])assert.equal(await inPlan(id),ids.includes(id)?1:0,'problem '+id);
      assert.equal(await problemRows.count(),ids.length);
    };
    await navigate();assert.equal(calls.length,0,'Opening the planner must be offline');
    await scan();await expectRows([10,13]);
    assert.ok(calls.some(x=>x.url.includes('page=2')),'The second homework list page was actually read');
    assert.equal(calls.filter(x=>x.url.startsWith(boardURL(102))).length,0,'Out-of-range boards should not be fetched');
    assert.ok(calls.some(x=>x.url.startsWith(boardURL(100)))&&calls.some(x=>x.url.startsWith(boardURL(101))));
    const merged=problemRows.filter({hasText:labels[10]});
    const href=await merged.locator('a').first().getAttribute('href');
    assert.match(new URL(href,origin).pathname,/^\/d\/test\/p\/(?:P)?10$/,'A result opens the actual problem');
    assert.equal((await merged.locator('td').nth(1).textContent()).trim(),'3','Use the maximum for one assignment; never sum the same people across boards');
    assert.match(await merged.textContent(),/作业甲/);assert.match(await merged.textContent(),/作业乙/);
    const firstCalls=calls.length;
    await scan(3);await expectRows([10]);assert.equal(calls.length,firstCalls,'Changing the local threshold must reuse API data');
    await navigate();assert.equal(calls.length,firstCalls,'Reload must not refresh a saved plan from the network');
    await expectRows([10]);await scan();await expectRows([10,13]);assert.equal(calls.length,firstCalls,'API cache survives reload');
    console.log('PASS homework plan: date boundaries, pagination, scoped AC counts, deduplication, profile solves and offline revisit');

    uid=71;await page.evaluate(()=>sessionStorage.setItem('fixture-account','71'));await navigate();
    assert.equal(await problemRows.count(),0,'An account change must not display the previous account\'s plan');
    const previousCalls=calls.length;await scan();await expectRows([10,12]);
    assert.ok(calls.length>previousCalls,'New account made its own requests');
    assert.ok(calls.some(x=>x.uid===71&&x.url.startsWith(boardURL(101))),'Even board cache is account-scoped');
    const beforeReset=calls.length;await page.locator('#exhloj-homework-plan-reset').click();
    assert.equal(calls.length,beforeReset,'Reset is explicit and does not prefetch');
    failBoard=hid(100);await scan(3);
    assert.ok(calls.slice(beforeReset).some(x=>x.url.startsWith(boardURL(100))),'Reset caused a fresh request on next scan');
    assert.match(await page.locator('#exhloj-local-dialog').textContent(),/部分|不完整|缺失|无权限|403/,'An unreadable board must be reported');
    const partialCalls=calls.length;await navigate();
    assert.equal(calls.length,partialCalls);await expectRows([10,12]);
    assert.equal(await form.locator('[name=threshold]').inputValue(),'2','A partial scan must preserve the last complete plan and its original filters');
    failBoard='';const beforeRetry=calls.length;await scan();await expectRows([10,12]);
    assert.ok(calls.slice(beforeRetry).some(x=>x.url.startsWith(boardURL(100))),'An error must not poison the cache');
    uid=42;await page.evaluate(()=>sessionStorage.setItem('fixture-account','42'));await navigate();
    const back=calls.length;await scan();await expectRows([10,13]);assert.equal(calls.length,back,'Resetting account 71 preserves account 42 caches');
    console.log('PASS homework plan: account isolation, scoped manual reset, partial result and retry');
    await page.locator('#exhloj-homework-plan-reset').click();
    let resume;
    try {
      holdBoard={id:hid(101),promise:new Promise(resolve=>{resume=resolve;})};
      const pending=page.waitForRequest(request=>new URL(request.url()).pathname===boardURL(101));
      await fields();await page.locator('#exhloj-homework-plan-scan').click();await pending;
      // A site session change can arrive via PJAX while a read for the old account is pending.
      uid=91;await page.evaluate(()=>{
        sessionStorage.setItem('fixture-account','91');window.UserContext={_id:91};
        window.dispatchEvent(new Event('pjax:end'));
      });
      resume();await form.waitFor({state:'hidden'});await open();
      assert.equal(await problemRows.count(),0,'Pending data must never become a new account\'s plan');
      await scan();await expectRows([10,12]);
    } finally {resume?.();}
    console.log('PASS homework plan: PJAX account transition during an outstanding scoreboard read');
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);await context.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
