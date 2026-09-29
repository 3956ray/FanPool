import assert from 'node:assert/strict';
import {JsonRpcProvider} from 'ethers';
import {writeFile} from 'node:fs/promises';
import {runDemo} from '../../scripts/local/demo.mjs';
let destroyed=0;const original=JsonRpcProvider.prototype.destroy;
JsonRpcProvider.prototype.destroy=function(){destroyed++;return original.call(this);};
const results=[];
try{
  await assert.rejects(runDemo({seedFile:'.local/intentionally-missing-seed.json'}),/ENOENT/);assert.equal(destroyed,1);results.push({case:'missing seed file',providerDestroyed:true});
  await assert.rejects(runDemo({seedFile:'docs/evidence/cp3/before-lifecycle-fix/seed-1.json'}),/another local session/);assert.equal(destroyed,2);results.push({case:'old session seed',providerDestroyed:true});
  const savedFetch=globalThis.fetch;
  try{globalThis.fetch=async(...args)=>{const response=await savedFetch(...args);const cfg=await response.json();return new Response(JSON.stringify({...cfg,chainId:1}),{status:200});};
    await assert.rejects(runDemo(),/非专用本机RPC/);assert.equal(destroyed,3);results.push({case:'context identity check rejection',providerDestroyed:true});
  }finally{globalThis.fetch=savedFetch;}
}finally{JsonRpcProvider.prototype.destroy=original;}
await writeFile('docs/evidence/cp3/provider-cleanup-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
