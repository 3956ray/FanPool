import assert from 'node:assert/strict';
import {connect,assertLocal,snapshot} from '../../web/chain.mjs';
const [session,pool]=process.argv.slice(2);
if(!session||!pool)throw new Error('usage: node scripts/local/verify-pool.mjs SESSION POOL');
const cfg=await(await fetch('http://127.0.0.1:4173/api/config',{cache:'no-store'})).json();
assert.equal(cfg.session,session,'Old local session. Refusing to inspect a reused address.');
const provider=connect();
try{
  await assertLocal(provider,cfg);const s=await snapshot(provider,cfg,pool);
  console.log(JSON.stringify({verified:true,session:cfg.session,chainId:cfg.chainId,rpc:cfg.rpc,factory:cfg.factory,pool:s.address,observer:cfg.roles[4].address,block:s.blockNumber,now:s.now,state:Number(s.state),fundingDeadline:String(s.fundingDeadline),purchaseDeadline:String(s.purchaseDeadline),settlementDeadline:String(s.settlementDeadline),balance:String(s.balance)},null,2));
}finally{provider.destroy();}
