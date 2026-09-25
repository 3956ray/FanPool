import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {once} from 'node:events';
import {writeFile,mkdir} from 'node:fs/promises';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const occupied=port=>new Promise(r=>{const s=createConnection({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false));});
assert.equal(await occupied(4173),false,'Stop known local service before lifecycle tests.');assert.equal(await occupied(8547),false);
await mkdir('docs/evidence/cp3',{recursive:true});
const sentinel=createServer((req,res)=>res.end('unrelated process untouched')).listen(0,'127.0.0.1');await once(sentinel,'listening');const sentinelURL=`http://127.0.0.1:${sentinel.address().port}`;
const results=[];
try{
  for(const [script,signal,expected]of[['scripts/local/replay-demo.mjs','SIGINT',130],['scripts/local/replay-demo.mjs','SIGTERM',143],['scripts/local/start.mjs','SIGTERM',0]]){
    const child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']});const exited=once(child,'exit');let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
    let cfg;for(let i=0;i<300;i++){if(child.exitCode!==null)throw new Error(`Early exit: ${output}`);try{const r=await fetch('http://127.0.0.1:4173/api/config');if(r.ok){cfg=await r.json();break;}}catch{}await wait(100);}
    assert.ok(cfg,'Local owned service must have started before interruption');
    child.kill(signal);const result=await Promise.race([exited,wait(15000).then(()=>{throw new Error('Cleanup timed out')})]);
    assert.equal(result[0],expected,output);for(let i=0;i<100&&(await occupied(4173)||await occupied(8547));i++)await wait(100);
    assert.equal(await occupied(4173),false);assert.equal(await occupied(8547),false);assert.equal(await(await fetch(sentinelURL)).text(),'unrelated process untouched');
    const name=`lifecycle-${script.includes('replay')?'replay':'start'}-${signal}`;await writeFile(`docs/evidence/cp3/${name}.log`,output);
    const row={script,signal,exitCode:result[0],session:cfg.session,ownWebPortReleased:true,ownRpcPortReleased:true,unrelatedSentinelUnchanged:true};results.push(row);console.log(JSON.stringify(row));
  }
}finally{sentinel.close();}
await writeFile('docs/evidence/cp3/lifecycle-results.json',JSON.stringify(results,null,2));
