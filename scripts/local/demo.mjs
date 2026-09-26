import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Contract} from 'ethers';
import {connect,assertLocal,signerFor,createPool,transact,snapshot,chainNow,ABI,friendlyError} from '../../web/chain.mjs';
const configURL='http://127.0.0.1:4173/api/config';
const json=(v)=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x,2);
const event=(name,data={})=>console.log(JSON.stringify({at:new Date().toISOString(),event:name,...data},(_,x)=>typeof x==='bigint'?x.toString():x));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function context(){const cfg=await(await fetch(configURL,{cache:'no-store'})).json();const provider=connect();try{await assertLocal(provider,cfg);return {cfg,provider};}catch(error){provider.destroy();throw error;}}
const link=(cfg,address)=>`http://127.0.0.1:4173/?pool=${address}&session=${cfg.session}`;
async function walletLedger(provider,cfg,pools){
  const block=await provider.send('eth_getBlockByNumber',['latest',false]);const token=new Contract(cfg.token,ABI.MockUSDC,provider);
  const names={organizer:cfg.roles[0].address,member1:cfg.roles[1].address,member2:cfg.roles[2].address,member3:cfg.roles[3].address,observer:cfg.roles[4].address,supplier:cfg.supplier,fulfillment:cfg.fulfillment,...pools};
  const balances={};for(const [name,address] of Object.entries(names))balances[name]={address,balance:await token.balanceOf(address,{blockTag:block.number})};
  return {blockNumber:Number(block.number),blockHash:block.hash,balances};
}
function delta(before,after,name){return after.balances[name].balance-before.balances[name].balance;}
function assertDelta(before,after,expected){for(const [name,amount]of Object.entries(expected))assert.equal(delta(before,after,name),amount,`${name} beneficiary delta`);}
export async function seedDemo({output='.local/demo-seed.json'}={}){
  const started=performance.now();const {cfg,provider}=await context();const org=cfg.roles[0].address;const members=cfg.roles.slice(1,4).map(x=>x.address);const transactions=[];
  async function tx(address,who,method,args=[]){const r=await transact(provider,cfg,who,address,method,args);const row={hash:r.hash,status:r.status,blockNumber:r.blockNumber,pool:address,actor:who,method};transactions.push(row);event('SEED_TRANSACTION',row);return r;}
  try{
    event('SEED_START',{disclosure:'仅本机MOCK；预置准备单独计时，不计入60秒演示。无需真实钱包。',session:cfg.session});
    const now=await chainNow(provider);const input={item:'10',reserve:'4',fee:'1',min:'2',max:'3',supplier:cfg.supplier,fulfillment:cfg.fulfillment,funding:now+600,purchase:now+1200,settlement:now+1800,reference:''};
    const normal=await createPool(provider,cfg,org,input);transactions.push({hash:normal.hash,status:1,method:'createPool',pool:normal.address});
    const timeout=await createPool(provider,cfg,org,input);transactions.push({hash:timeout.hash,status:1,method:'createPool',pool:timeout.address});
    for(const pool of [normal.address,timeout.address])for(const member of members)await tx(pool,member,'join');
    await tx(timeout.address,org,'paySupplier');
    const A=await snapshot(provider,cfg,normal.address),B=await snapshot(provider,cfg,timeout.address);
    assert.equal(A.state,1n);assert.equal(A.lockedN,3n);assert.equal(A.balance,45000000n);assert.equal(B.state,2n);assert.equal(B.balance,15000000n);
    const record={version:1,session:cfg.session,anchor:cfg.anchor,normal:normal.address,timeout:timeout.address,normalURL:link(cfg,normal.address),timeoutURL:link(cfg,timeout.address),createdAt:new Date().toISOString(),seedMs:Math.round(performance.now()-started),transactions,ledger:await walletLedger(provider,cfg,{normal:normal.address,timeout:timeout.address}),stages:{normal:'PRESEEDED_READY_N3_45_MOCK',timeout:'PRESEEDED_PURCHASED_N3_15_MOCK'}};
    await mkdir('.local',{recursive:true});await writeFile(output,json(record));event('SEED_COMPLETE',{session:cfg.session,seedMs:record.seedMs,normalURL:record.normalURL,timeoutURL:record.timeoutURL,stages:record.stages});return record;
  }finally{provider.destroy();}
}
export async function runDemo({seedFile='.local/demo-seed.json',output='.local/demo-run.json',pace=true}={}){
  const {cfg,provider}=await context();try{const seed=JSON.parse(await readFile(seedFile,'utf8'));const org=cfg.roles[0].address,observer=cfg.roles[4].address,members=cfg.roles.slice(1,4).map(x=>x.address);
  assert.equal(seed.session,cfg.session,'Seed belongs to another local session; reset and seed again.');assert.equal(seed.anchor.hash,cfg.anchor.hash,'Seed anchor mismatch.');
  const A=await snapshot(provider,cfg,seed.normal),B=await snapshot(provider,cfg,seed.timeout);assert.equal(A.state,1n,'Normal seed must still be READY.');assert.equal(B.state,2n,'Timeout seed must still be PURCHASED.');assert.equal(A.balance,45000000n);assert.equal(B.balance,15000000n);assert.equal(B.s,0n);assert.ok(A.now<A.purchaseDeadline,'Normal seed expired; create a fresh seed.');
  const initial=await walletLedger(provider,cfg,{normal:seed.normal,timeout:seed.timeout});const started=performance.now();const transactions=[];const stages=[];
  async function at(seconds,label){if(pace)await wait(Math.max(0,seconds*1000-(performance.now()-started)));const row={label,elapsedMs:Math.round(performance.now()-started)};stages.push(row);event('DEMO_STAGE',row);}
  async function tx(pool,who,method,args=[]){const r=await transact(provider,cfg,who,pool,method,args);const row={pool,actor:who,method,args,hash:r.hash,status:r.status,blockNumber:r.blockNumber,elapsedMs:Math.round(performance.now()-started)};assert.equal(r.status,1);transactions.push(row);event('CONFIRMED_TRANSACTION',row);return r;}
    await at(0,'本地MOCK预置展示：I10+R4+F1=C15；池A已预置READY/N3/45，池B已预置采购后失联。准备耗时不计入本演示。');
    event('PRESEEDED',{normalURL:seed.normalURL,timeoutURL:seed.timeoutURL,normalBalance:A.balance,timeoutBalance:B.balance,seedMs:seed.seedMs});
    await at(8,'精确商品付款30，只到固定supplier');await tx(seed.normal,org,'paySupplier');
    await at(15,'s=5策略拒绝：eth_call静态模拟，无失败交易hash，不广播失败交易');
    const beforeReject=await snapshot(provider,cfg,seed.normal);const pool=new Contract(seed.normal,ABI.FanPool,await signerFor(provider,cfg,org));let rejection;
    try{await pool.payFulfillment.staticCall(5000000n);assert.fail('cap should reject');}catch(e){const parsed=pool.interface.parseError(e.data);assert.equal(parsed.name,'FulfillmentRejected');rejection={type:'eth_call_static_simulation',broadcast:false,transactionHash:null,error:parsed.name,message:friendlyError(e)};}
    const afterReject=await snapshot(provider,cfg,seed.normal);assert.equal(beforeReject.balance,afterReject.balance);assert.equal(afterReject.s,0n);assert.equal(afterReject.fulfillmentExecuted,false);assert.equal(beforeReject.events.length,afterReject.events.length);event('POLICY_REJECTED',{...rejection,poolBalanceUnchanged:afterReject.balance});
    await at(23,'合法s=2，运输总额6');await tx(seed.normal,org,'payFulfillment',[2000000n]);
    await at(29,'正常关闭只是资金操作结束，不是实物送达');await tx(seed.normal,org,'closeNormal');
    await at(33,'旁观者替三地址各领2，再向organizer付采购费3');for(const member of members)await tx(seed.normal,observer,'claimRefundFor',[member]);await tx(seed.normal,observer,'claimFee');
    const normalAfter=await walletLedger(provider,cfg,{normal:seed.normal,timeout:seed.timeout});
    assertDelta(initial,normalAfter,{normal:-45000000n,timeout:0n,member1:2000000n,member2:2000000n,member3:2000000n,organizer:3000000n,observer:0n,supplier:30000000n,fulfillment:6000000n});
    assert.equal(normalAfter.balances.normal.balance,0n);event('NORMAL_CONSERVATION',{equation:'45 = 30 + 6 + 6 + 3; pool = 0',beneficiaryDeltasVerified:true,ledger:normalAfter});
    await at(45,'切到预置失联池B：显式快进本地链时间，任何人关闭；不回收已付商品款');
    await assertLocal(provider,cfg);const now=await chainNow(provider);const target=Number(B.settlementDeadline);if(target>now)await provider.send('evm_increaseTime',[target-now]);await provider.send('evm_mine',[]);event('LOCAL_TIME_ADVANCED',{target,scope:'all pools on this dedicated local chain',automaticClose:false});
    await tx(seed.timeout,observer,'closeTimeout');for(const member of members)await tx(seed.timeout,observer,'claimRefundFor',[member]);await tx(seed.timeout,observer,'claimFee');
    const final=await walletLedger(provider,cfg,{normal:seed.normal,timeout:seed.timeout});
    assertDelta(normalAfter,final,{normal:0n,timeout:-15000000n,member1:4000000n,member2:4000000n,member3:4000000n,organizer:3000000n,observer:0n,supplier:0n,fulfillment:0n});
    assert.equal(final.balances.timeout.balance,0n);const closed=await snapshot(provider,cfg,seed.timeout);assert.equal(closed.closeReason,3n);assert.equal(closed.paidItem,30000000n);assert.equal(closed.refunded,12000000n);assert.equal(closed.paidFee,3000000n);
    event('TIMEOUT_CONSERVATION',{equation:'remaining 15 = refunds 12 + fee 3; pool = 0',perMemberRefund:'4 MOCK',procurementFeeNotRefunded:'1 MOCK/member',beneficiaryDeltasVerified:true,ledger:final});
    await at(60,'完成：两池0余额；全部受益人正确。MOCK无真实价值，不保证实物，CP4未授权。');
    const report={session:cfg.session,anchor:cfg.anchor,seedMs:seed.seedMs,demoMs:Math.round(performance.now()-started),paced:pace,normal:seed.normal,timeout:seed.timeout,transactions,rejection,stages,initial,normalAfter,final,checks:{allReceiptsStatus1:true,normalConservation:true,timeoutConservation:true,allBeneficiaryDeltas:true,noFailedTransactionInvented:true}};
    await writeFile(output,json(report));event('DEMO_COMPLETE',{session:cfg.session,demoMs:report.demoMs,confirmedTransactions:transactions.length,output});return report;
  }finally{provider.destroy();}
}
export async function checkDemo({seedFile='.local/demo-seed.json'}={}){const {cfg,provider}=await context();try{const seed=JSON.parse(await readFile(seedFile,'utf8'));assert.equal(seed.session,cfg.session);for(const [name,address]of [['normal',seed.normal],['timeout',seed.timeout]]){const s=await snapshot(provider,cfg,address);event('CHECK',{name,address,state:s.state,closeReason:s.closeReason,balance:s.balance,paidItem:s.paidItem,paidShipping:s.paidShipping,refunds:s.refunded,fee:s.paidFee,block:s.blockNumber});}}finally{provider.destroy();}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const command=process.argv[2];if(command==='seed')await seedDemo();else if(command==='run')await runDemo();else if(command==='check')await checkDemo();else throw new Error('usage: node scripts/local/demo.mjs seed|run|check');}
