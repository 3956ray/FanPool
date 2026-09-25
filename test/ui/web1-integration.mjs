import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {connect,assertLocal,createPool,transact,snapshot,registeredPools,chainNow} from '../../web/chain.mjs';
import {participation,readRoute,routeURL} from '../../web/routes.mjs';
const base='http://127.0.0.1:4173',cfg=await(await fetch(base+'/api/config')).json(),p=connect();const [a,b,c]=cfg.roles.map(r=>r.address),receipts=[],steps=[];
try{await assertLocal(p,cfg);const now=await chainNow(p);const input={title:'WEB1',reference:'',item:'10',reserve:'4',fee:'1',min:'1',max:'2',funding:now+3600,purchase:now+7200,settlement:now+10800,supplier:cfg.supplier,fulfillment:cfg.fulfillment};
const created=await createPool(p,cfg,a,input);receipts.push(created.hash);const pool=created.address;
async function tx(who,method,args=[]){const r=await transact(p,cfg,who,pool,method,args);assert.equal(r.status,1);receipts.push(r.hash);}
async function check(kind){const snap=await snapshot(p,cfg,pool);assert.equal(participation(snap,b).kind,kind);steps.push({kind,block:snap.blockNumber});}
await tx(b,'join');await check('active');await tx(b,'exit');await check('exited');await tx(b,'join');await check('active');await tx(c,'join');await tx(a,'paySupplier');await tx(a,'payFulfillment',[2000000n]);await tx(a,'closeNormal');await check('claimable');await tx(c,'claimRefundFor',[b]);await check('claimed');await tx(c,'claimRefundFor',[c]);await tx(c,'claimFee');assert.equal((await snapshot(p,cfg,pool)).balance,0n);
const list=await registeredPools(p,cfg);assert.ok(list.filter(x=>x.organizer.toLowerCase()===a.toLowerCase()).some(x=>x.address===pool));assert.ok(!list.filter(x=>x.organizer.toLowerCase()===b.toLowerCase()).some(x=>x.address===pool));
const http=[];for(const path of ['/','/create','/my','/manage',`/pools/${pool}`,'/unknown','/pools/invalid',`/?pool=${pool}&session=${cfg.session}`]){const r=await fetch(base+path);assert.equal(r.status,200);assert.match(await r.text(),/id="app"/);http.push({path,status:r.status});}for(const path of ['/api/missing','/missing.js'])assert.equal((await fetch(base+path)).status,404);
for(const path of ['/','/create','/my','/manage',`/pools/${pool}`])assert.equal(readRoute(routeURL(path,'old'),cfg.session).view,'error');
await mkdir('docs/evidence/web1',{recursive:true});await writeFile('docs/evidence/web1/integration.json',JSON.stringify({session:cfg.session,pool,steps,receipts,http,result:'PASS'},null,2));console.log(JSON.stringify({result:'PASS',pool,steps,receipts:receipts.length,http:http.length}));
}finally{p.destroy();}
