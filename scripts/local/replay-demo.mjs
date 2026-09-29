import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {open,readFile,writeFile,mkdir} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {seedDemo,runDemo} from './demo.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const occupied=port=>new Promise(r=>{const s=createConnection({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false));});
if(await occupied(4173)||await occupied(8547))throw new Error('Refusing to stop unknown/existing service. Stop the known FanPool parent before replay.');
await mkdir('docs/evidence/cp3',{recursive:true});const rounds=[];let current;
let cleanupPromise;let signalExitCode=null;
async function stopOwned(){
  if(cleanupPromise)return cleanupPromise;
  const owned=current;if(!owned)return;
  cleanupPromise=(async()=>{
    owned.kill('SIGTERM');
    let clearSamples=0;
    for(let i=0;i<100;i++){
      if(!await occupied(4173)&&!await occupied(8547))clearSamples++;else clearSamples=0;
      if(clearSamples>=3){current=null;return;}await wait(100);
    }
    throw new Error('Owned service did not stop cleanly; not touching other processes.');
  })();
  try{await cleanupPromise;}finally{cleanupPromise=null;}
}
async function handleSignal(signal){
  if(signalExitCode!==null)return;
  signalExitCode=signal==='SIGINT'?130:143;
  try{await stopOwned();process.exit(signalExitCode);}catch(e){console.error(e);process.exit(1);}
}
process.on('SIGINT',()=>handleSignal('SIGINT'));
process.on('SIGTERM',()=>handleSignal('SIGTERM'));

try{
  for(let round=1;round<=2;round++){
    const log=await open(`docs/evidence/cp3/start-${round}.log`,'w');
    current=spawn(process.execPath,['scripts/local/start.mjs'],{stdio:['ignore',log.fd,log.fd],detached:true});await log.close();
    let cfg;for(let i=0;i<200;i++){if(current.exitCode!==null)throw new Error('Owned local start failed');try{const response=await fetch('http://127.0.0.1:4173/api/config');if(response.ok){cfg=await response.json();break;}}catch{}await wait(100);}
    assert.ok(cfg,'Server startup timeout');if(round===2)assert.notEqual(cfg.session,rounds[0].session,'clean sessions must differ');
    const seedFile=`docs/evidence/cp3/seed-${round}.json`,runFile=`docs/evidence/cp3/run-${round}.json`;
    const seed=await seedDemo({output:seedFile});const run=await runDemo({seedFile,output:runFile});
    rounds.push({round,session:cfg.session,seedMs:seed.seedMs,demoMs:run.demoMs,confirmedTransactions:run.transactions.length,serverPid:current.pid,seedFile,runFile});
    await writeFile('docs/evidence/cp3/replay-summary.json',JSON.stringify(rounds,null,2));
    if(round===1)await stopOwned();
    else{await writeFile('.local/demo-seed.json',await readFile(seedFile));current.unref();console.log(JSON.stringify({event:'PREVIEW_LEFT_RUNNING',pid:current.pid,url:'http://127.0.0.1:4173',session:cfg.session}));current=null;}
  }
}catch(error){await stopOwned();if(signalExitCode!==null)process.exit(signalExitCode);throw error;}
