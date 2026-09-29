import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const meta=JSON.parse(await readFile('dist-public/metafile.json'));
const outputs=Object.keys(meta.outputs).filter(f=>f.endsWith('.js'));
const all=(await Promise.all(outputs.map(f=>readFile(f,'utf8')))).join('\n');const app=await readFile('dist-public/app.js','utf8');
for(const forbidden of ['127.0.0.1:8547','AUTH_TOKEN_KEY','AUTH_DATABASE_URL','fanpool_private','127.0.0.1:8548','TEST_AUTH_STUB','/test/login','127.0.0.1:8549','TEST ONLY · PUBLIC=true','INDEX_WORKER_SECRET','INDEX_WORKER_DATABASE_URL'])assert.ok(!all.includes(forbidden),forbidden);
assert.ok(!app.includes('evm_increaseTime'));assert.ok(!app.includes('领取 1,000 MOCK'));assert.ok(!Object.keys(meta.inputs).includes('web/chain.mjs'));assert.ok(!Object.keys(meta.inputs).some(f=>f.startsWith('test/')));
const base='http://127.0.0.1:4174',cfg=await(await fetch(base+'/api/config')).json();assert.equal(cfg.mode,'public');assert.equal(cfg.deployed,false);assert.equal(cfg.chainId,10143);assert.equal((await fetch(base+'/api/auth/session')).status,503);
const http=[];for(const path of ['/','/create','/my','/manage','/pools/bad']){const r=await fetch(base+path);assert.equal(r.status,200);http.push({path,status:r.status});}
for(const path of ['/missing.png','/missing.json','/missing.map','/api/advance']){const r=await fetch(base+path);assert.equal(r.status,404);http.push({path,status:r.status});}
await writeFile(process.env.FANPOOL_VERIFY_OUTPUT||'docs/evidence/web2/build-isolation.json',JSON.stringify({result:'PASS',publicConfig:cfg,http,checks:['no local RPC/server secrets in any emitted chunk','no local time/mint controls in app entry','no local chain module in dependency graph','unconfigured auth 503'],limit:'Third-party AppKit/viem may include generic test-chain helper names; not wired to FanPool controls or localhost RPC.'},null,2));console.log('Public build isolation / HTTP pending states / assets404 PASS');
