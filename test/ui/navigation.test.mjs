import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as routes from '../../web/routes.mjs';
import * as metadataModule from '../../web/metadata.mjs';
import * as domain from '../../web/domain.mjs';
const source=(await readFile(new URL('../../web/app.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/init\(\);\s*$/,'');
const org='0x'+'12'.repeat(20),member='0x'+'34'.repeat(20),pool='0x'+'56'.repeat(20);
function setup(){let reads=0,fail=false,hold=null;const root={innerHTML:''};const location={href:'http://127.0.0.1:4173/',origin:'http://127.0.0.1:4173',pathname:'/',search:''};const move=url=>{const u=new URL(url,location.href);Object.assign(location,{href:u.href,pathname:u.pathname,search:u.search});};const cfg={session:'current',chainId:31338,roles:[{address:org,name:'org'},{address:member,name:'member'}],token:org,supplier:member,fulfillment:pool};const snap={address:pool,organizer:org,state:0n,blockNumber:1,events:[{name:'Joined',args:{owner:member}}],members:[{owner:member,active:true,claimed:false}],reserve:4n,s:0n,commitment:15n,item:10n,fee:1n,min:1n,max:2n,fundedCount:1n,lockedN:0n,fundingDeadline:999999n,purchaseDeadline:1999999n,settlementDeadline:2999999n,now:123456,supplier:member,fulfillment:pool,balance:15n,liability:15n,surplus:0n,paidItem:0n,paidShipping:0n,refunded:0n,paidFee:0n};
const ctx=vm.createContext({...routes,...domain,...metadataModule,URL,Date,Intl,console,location,history:{pushState:(_,__,url)=>move(url),replaceState:(_,__,url)=>move(url)},document:{querySelector:sel=>sel==='#app'?root:null,querySelectorAll:()=>[],addEventListener(){},activeElement:null},window:{addEventListener(){}},setInterval(){},sessionStorage:{getItem:()=>null,setItem(){}},localStorage:{getItem:()=>null},connect:()=>({}),assertLocal:async()=>{reads++;if(fail)throw Error('offline');},chainNow:async()=>123456,Contract:class{async balanceOf(){return 100n;}async allowance(){return 0n;}},ABI:{},registeredPools:async()=>[{address:pool,organizer:org}],snapshot:async()=>{const wait=hold;hold=null;if(wait)await wait;return snap;},friendlyError:e=>e.message});
vm.runInContext(source,ctx);ctx.cfg=cfg;vm.runInContext('S.config=cfg;',ctx);return {ctx,root,move,reads:()=>reads,offline:v=>fail=v,hold:promise=>hold=promise,run:code=>vm.runInContext(code,ctx)};}
test('actual app rejects old session on every route without a chain read',async()=>{const h=setup();for(const path of ['/','/create','/my','/manage','/pools/'+pool]){h.move(path+'?session=old');await h.run('loadRoute()');assert.match(h.root.innerHTML,/旧模拟会话/);assert.equal(h.reads(),0);}});
test('actual app delayed list cannot overwrite navigation or role results',async()=>{const h=setup();let release;h.hold(new Promise(r=>release=r));h.move('/my');const pending=h.run('loadRoute()');await new Promise(r=>setImmediate(r));h.move('/create');await h.run('loadRoute()');release();await pending;assert.equal(h.run('S.view'),'create');assert.equal(h.run('S.history.length'),0);assert.match(h.root.innerHTML,/创建一份共同约定/);
h.move('/my');await h.run('loadRoute()');assert.match(h.root.innerHTML,/该地址尚无参与记录/);await h.run('S.role=1;refresh()');h.run('render()');assert.match(h.root.innerHTML,/当前出资/);
let releaseRole;h.hold(new Promise(r=>releaseRole=r));const old=h.run('refresh()');await new Promise(r=>setImmediate(r));await h.run('S.role=0;refresh()');releaseRole();await old;h.run('render()');assert.match(h.root.innerHTML,/该地址尚无参与记录/);});
test('actual app invalid / unknown / unregistered routes and offline recovery',async()=>{const h=setup();h.move('/pools/bad');await h.run('loadRoute()');assert.match(h.root.innerHTML,/池地址格式不正确/);h.move('/missing');await h.run('loadRoute()');assert.match(h.root.innerHTML,/404/);h.move('/pools/'+org);await h.run('loadRoute()');assert.match(h.root.innerHTML,/当前链上不存在此池/);h.move('/manage');h.offline(true);await h.run('loadRoute()');assert.match(h.root.innerHTML,/连接需要恢复/);h.offline(false);await h.run('loadRoute()');assert.match(h.root.innerHTML,/团主管理/);assert.equal(h.run('S.unavailable'),false);});

test('actual app detail render and legacy link canonicalization retain policies',async()=>{const h=setup();h.move('/?pool='+pool+'&session=current');await h.run('loadRoute()');assert.equal(h.run('location.pathname'),'/pools/'+pool);assert.match(h.root.innerHTML,/采购后，执行费不退/);assert.match(h.root.innerHTML,/退款与采购费/);assert.match(h.root.innerHTML,/session=current/);assert.equal(h.run('S.p.address'),pool);h.move('/manage');await h.run('loadRoute()');assert.match(h.root.innerHTML,/1 个资金池/);await h.run('S.role=1;refresh()');h.run('render()');assert.match(h.root.innerHTML,/该地址尚未创建资金池/);});


test('delayed receipt success or failure cannot notify a different route',async()=>{
  for(const path of ['/my','/manage','/create'])for(const failed of [false,true]){
    const h=setup();h.move('/pools/'+pool);await h.run('loadRoute()');let resolve,reject;
    h.ctx.pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
    const operation=h.run("execute('old pool transaction',()=>pending)");
    h.move(path);await h.run('loadRoute()');
    if(failed)reject(new Error('old transaction failed'));else resolve({hash:'0xconfirmed'});
    await operation;assert.equal(h.run('S.notice'),null);assert.equal(h.run('location.pathname'),path);assert.equal(h.run('S.busy'),false);
  }
});
test('confirmed creation can notify its new detail route when address exists',async()=>{
  const h=setup();h.move('/create');await h.run('loadRoute()');let resolve;
  h.ctx.pending=new Promise(r=>resolve=r);const operation=h.run("execute('create pool',()=>pending)");
  h.move('/pools/'+pool);await h.run('loadRoute()');resolve({address:pool,hash:'0xcreated'});await operation;
  assert.equal(h.run('S.notice.type'),'success');assert.equal(h.run('S.notice.hash'),'0xcreated');
});

test('actual product metadata read failure leaves chain facts and refund action usable without auth',async()=>{const h=setup();h.ctx.readMetadata=async()=>({status:'unavailable',data:null});h.run('S.config.metadataEnabled=true');h.move('/pools/'+pool);await h.run('loadRoute()');h.run('S.p.state=3n;render()');assert.match(h.root.innerHTML,/商品资料暂不可用/);assert.match(h.root.innerHTML,/为此地址领取/);assert.equal(h.run('S.unavailable'),false);let calls=0;h.ctx.transact=async()=>{calls++;return {hash:'refund'};};await h.run("execute('退款',()=>transact())");assert.equal(calls,1);assert.equal(h.run('typeof authAPI'),'undefined');});
