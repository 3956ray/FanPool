import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const load=async file=>JSON.parse(await readFile(`docs/evidence/cp3/${file}`,'utf8'));
const delta=(a,b,k)=>BigInt(b.balances[k].balance)-BigInt(a.balances[k].balance);
test('two distinct clean sessions provide actual ~60 second runs and 12 unique successful receipts each',async()=>{
  const [a,b,summary,seed1,seed2]=await Promise.all([load('run-1.json'),load('run-2.json'),load('replay-summary.json'),load('seed-1.json'),load('seed-2.json')]);assert.equal(summary.length,2);assert.equal(summary[0].session,a.session);assert.equal(summary[1].session,b.session);assert.equal(seed1.session,a.session);assert.equal(seed2.session,b.session);assert.equal(seed1.anchor.hash,a.anchor.hash);assert.equal(seed2.anchor.hash,b.anchor.hash);assert.notEqual(a.session,b.session);assert.notEqual(a.anchor.hash,b.anchor.hash);
  for(const r of[a,b]){assert.ok(r.demoMs>=60000&&r.demoMs<75000);assert.ok(r.seedMs>0);assert.equal(r.transactions.length,12);assert.equal(new Set(r.transactions.map(t=>t.hash)).size,12);for(const t of r.transactions){assert.equal(t.status,1);assert.match(t.hash,/^0x[0-9a-fA-F]{64}$/);assert.ok(t.blockNumber>0);}assert.equal(r.rejection.broadcast,false);assert.equal(r.rejection.transactionHash,null);assert.equal(r.rejection.error,'FulfillmentRejected');}
});
test('recorded before/after ledgers independently preserve every beneficiary and both pool equations',async()=>{
  for(const file of['run-1.json','run-2.json']){const r=await load(file);
    const normal={normal:-45000000n,timeout:0n,member1:2000000n,member2:2000000n,member3:2000000n,organizer:3000000n,observer:0n,supplier:30000000n,fulfillment:6000000n};
    const lost={normal:0n,timeout:-15000000n,member1:4000000n,member2:4000000n,member3:4000000n,organizer:3000000n,observer:0n,supplier:0n,fulfillment:0n};
    for(const[k,v]of Object.entries(normal))assert.equal(delta(r.initial,r.normalAfter,k),v);
    for(const[k,v]of Object.entries(lost))assert.equal(delta(r.normalAfter,r.final,k),v);
    assert.equal(BigInt(r.final.balances.normal.balance),0n);assert.equal(BigInt(r.final.balances.timeout.balance),0n);
  }
});
