'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const scan = vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/homework-plan-data.js'), 'utf8') + '\nscanHomeworkPlan');
const start = Date.parse('2026-11-01T00:00:00Z'), end = Date.parse('2026-11-03T00:00:00Z');
const home = '/d/oi/homework', profile = '/d/oi/user/17';
const hw = (docId, begin = start) => ({ docId, domainId:'oi', rule:'homework', title:'作业'+docId, beginAt:new Date(begin).toISOString() });
const head = pids => [{type:'user'},...pids.map(pid=>({type:'problem',raw:pid,value:'A'}))];
const board = (docId,pids,people,dict,extra={}) => ({
  tdoc:{docId,domainId:'oi',rule:'homework',pids,beginAt:new Date(start).toISOString()}, pdict:dict, rows:[head(pids),...people.map(([uid,...cells])=>[{type:'user',raw:uid},...cells])], ...extra
});
const rec = score => ({type:'record',score});
const own = (ids,total=ids.length,more={})=>({isSelfProfile:true, udoc:{_id:17,nAccept:total},pdocs:ids.map(docId=>({domainId:'oi',docId})),...more});
const dict = (key,nAccept) => ({docId:key,title:'题'+key,hidden:false,...nAccept===null?{}:{nAccept}});
const prob = (docId,psdoc)=>({pdoc:{docId,domainId:'oi'},psdoc});
const forScan = async (data, opts={})=>{
  const called=[]; const result=await scan({domain:'oi',uid:17,start,end,threshold:2,read:async(url,view,project)=>{
    called.push(url); if (!(url in data)) throw new Error('404: '+url);
    const b=data[url]; if(b instanceof Error)throw b;return project(b);
  }, ...opts}); return {result:JSON.parse(JSON.stringify(result)),called};
};
(async()=>{
  // Full real Hydro scoreboard summary counts even a student's earlier AC before a later partial record.
  const a=hw('a'), b=hw('b',end-1); delete b.beginAt;
  const dataset = {
    [home+'?page=1']:{tdocs:[a,hw('outside',end),hw('old',start-1)],tpcount:2,page:1},
    [home+'?page=2']:{tdocs:[b],tpcount:2,page:2},
    [home+'/a/scoreboard']:board('a',[1,2,3,4],[[17,rec(20),{},{type:'record',raw:{status:1}},{}],[20,rec(100),rec(100),{},{}]],{
      1:dict(1,5),2:dict(2,3),3:dict(3,1),4:dict(4,1)}),
    [home+'/b/scoreboard']:board('b',[1,3,4,5],[[18,rec(100),rec(100),rec(100),rec(100)]],{
      1:dict(1,2),3:dict(3,4),4:dict(4,1),5:dict(5,2)}),
    [profile]:own([2])
  };
  let {result:r,called}=await forScan(dataset);assert.equal(r.complete,true);assert.equal(r.scanned,2);assert.equal(r.matched,2);
  assert.deepEqual(r.rows.map(x=>[x.pid,x.passed,x.href,x.homeworks.map(h=>h.passed)]),[
    ['1',5,'/d/oi/p/1',[5,2]],['5',2,'/d/oi/p/5',[2]]]);
  assert.ok(!called.some(x=>x.includes('outside')||x.includes('/old')||x.includes('/p/')));assert.equal(called.filter(x=>x===profile).length,1); assert.equal(called.filter(x=>x===home+'/b/scoreboard').length,1); assert.ok(!called.includes(home+'/b'));

  // Paginated forks: deduplicate a repeated participant. Penalized full raw scores and score-only variants count; explicit WA takes precedence.
  const pgdata = {[home+'?page=1']:{tdocs:[a],tpcount:1},
    [home+'/a/scoreboard']:board('a',[7,8],[[1,rec(100),{type:'record',score:100,raw:{status:2}}],[2,{type:'record',value:'60 / 100\n1:23'},rec(80)]],
      {7:dict(7,2),8:dict(8,0)},{page:1,pageCount:2}),
    [home+'/a/scoreboard?page=2']:board('a',[7,8],[[2,rec(100),{}],[3,{type:'records',raw:[{status:2},{status:1}]},{}]],
      {7:dict(7,2),8:dict(8,0)},{page:2,pageCount:2}),[profile]:own([42])};
  r=(await forScan(pgdata)).result; assert.deepEqual(r.rows.map(p=>[p.pid,p.passed]),[['7',3]]);
  const glob={...pgdata}; for(const [key,v] of Object.entries(glob)) if(key.includes('scoreboard')) glob[key]={...v,pdict:{...v.pdict,7:dict(7,3)}};
  r=(await forScan(glob)).result;assert.deepEqual(r.rows.map(p=>[p.pid,p.passed]),[['7',3]]);
  const dup={...pgdata,[home+'/a/scoreboard?page=2']:{...pgdata[home+'/a/scoreboard'],page:2}};
  r=(await forScan(dup)).result;assert.equal(r.complete,false);assert.equal(r.rows.length,0);

  // Missing profile entries do not prove unsolved if the profile is incomplete. Failure to confirm never produces a candidate.
  const hidd={...dataset,[home+'/a/scoreboard']:{...dataset[home+'/a/scoreboard'],pdict:{...dataset[home+'/a/scoreboard'].pdict,1:{...dict(1,5),hidden:true}}},
    [home+'/b/scoreboard']:{...dataset[home+'/b/scoreboard'],pdict:{...dataset[home+'/b/scoreboard'].pdict,1:{...dict(1,2),hidden:true}}},
    [profile]:own([2],1),'/d/oi/p/1':prob('1',{uid:17,status:1})};
  r=(await forScan(hidd)).result;assert.equal(r.complete,true);assert.deepEqual(r.rows.map(x=>x.pid),['5']);
  r=(await forScan({...hidd,'/d/oi/p/1':prob('1',{uid:17,status:2})})).result;assert.equal(r.rows[0].href,'/d/oi/p/1?tid=a');
  const partial={...dataset,[profile]:own([],8),'/d/oi/p/1':prob('1',{uid:17,status:2}),'/d/oi/p/2':prob('2',{uid:17,status:1}),'/d/oi/p/5':new Error('403')};
  r=(await forScan(partial)).result;assert.deepEqual(r.rows.map(x=>x.pid),['1']);assert.equal(r.complete,false);assert.match(r.warnings.join(),/题目 5/);
  r=(await forScan({...partial,[profile]:{pdict:{1:{}},psdocs:[],udoc:{_id:17}},'/d/oi/p/1':prob('1',null)})).result;
  assert.equal(r.complete,false);assert.deepEqual(r.rows,[]); // null without a verified self profile cannot prove login.
  await assert.rejects(()=>forScan({...dataset,[profile]:{...own([]),isSelfProfile:false}}),/登录身份/);
  await assert.rejects(()=>forScan({...dataset,[home+'?page=1']:Object.assign(new Error('请求上限'),{budget:true})}),/请求上限/);
  r=(await forScan(dataset,{pageLimit:1})).result;assert.equal(r.complete,false);assert.match(r.warnings.join(),/页上限/);assert.equal(r.matched,1);
  r=(await forScan({...dataset,[home+'/a/scoreboard']:{...dataset[home+'/a/scoreboard'],tdoc:{...dataset[home+'/a/scoreboard'].tdoc,domainId:'other'}}})).result;
  assert.equal(r.complete,false);assert.match(r.warnings.join(),/不属于当前域/);
  console.log('Homework planner data: date bounds, Hydro pagination/AC counts, tie-free UID counting, global self status and incomplete data passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
