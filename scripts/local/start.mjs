import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {JsonRpcProvider,ContractFactory,keccak256} from 'ethers';
import {RPC,CHAIN_ID} from '../../web/domain.mjs';
const HOST='127.0.0.1',WEB_PORT=4173,RPC_PORT=8547;
async function occupied(port){return await new Promise(r=>{const s=createConnection({host:HOST,port});s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false));});}
if(await occupied(WEB_PORT)||await occupied(RPC_PORT))throw new Error('专用端口4173/8547已占用。请先停止之前的FanPool进程；不会连接未知RPC。');
execFileSync(`${process.env.HOME}/.foundry/bin/forge`,['build','--quiet'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/local/build.mjs'],{stdio:'inherit'});
await mkdir('.local',{recursive:true});
const anvil=spawn(`${process.env.HOME}/.foundry/bin/anvil`,['--host',HOST,'--port',String(RPC_PORT),'--chain-id',String(CHAIN_ID),'--accounts','8','--block-time','1','--silent'],{stdio:'ignore'});
let server;let shutting=false;
function stop(code=0){if(shutting)return;shutting=true;server?.close();anvil.kill('SIGTERM');process.exit(code);}
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));process.on('exit',()=>anvil.kill('SIGTERM'));
anvil.on('error',e=>{console.error('Anvil启动失败:',e.message);stop(1);});
anvil.on('exit',()=>{if(!shutting){console.error('Anvil退出，停止网页以防陈旧配置。');stop(1);}});
try {
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})});const d=await r.json();if(Number(d.result)===CHAIN_ID){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!ready)throw new Error('Anvil未在预期专用链启动。');
  const provider=new JsonRpcProvider(RPC,undefined,{cacheTimeout:-1,pollingInterval:200});
  const accounts=await provider.send('eth_accounts',[]);const signer=await provider.getSigner(accounts[0]);
  const artifact=async n=>JSON.parse(await readFile(`out/${n}.sol/${n}.json`,'utf8'));
  const t=await artifact('MockUSDC');const token=await new ContractFactory(t.abi,t.bytecode.object,signer).deploy();await token.waitForDeployment();
  const f=await artifact('FanPoolFactory');const factory=await new ContractFactory(f.abi,f.bytecode.object,signer).deploy(await token.getAddress());await factory.waitForDeployment();
  for(const account of accounts.slice(0,5)){await (await token.mint(account,1000n*1000000n)).wait();}
  const session=randomUUID();
  // A random unused account balance makes the anchor unique even for immediate restarts.
  const marker=`0x${session.replaceAll('-','').padEnd(40,'0')}`;await provider.send('anvil_setBalance',[marker,'0x1']);await provider.send('evm_mine',[]);
  const anchor=await provider.send('eth_getBlockByNumber',['latest',false]);
  const config={rpc:RPC,chainId:CHAIN_ID,session,token:await token.getAddress(),factory:await factory.getAddress(),anchor:{number:anchor.number,hash:anchor.hash},
    codeHashes:{token:keccak256(await provider.getCode(await token.getAddress())),factory:keccak256(await provider.getCode(await factory.getAddress()))},
    roles:accounts.slice(0,5).map((address,i)=>({address,name:['组织者','加入者 · 小雨','加入者 · 阿星','加入者 · 可可','旁观者'][i]})),supplier:accounts[5],fulfillment:accounts[6],startedAt:new Date().toISOString()};
  await writeFile('.local/config.json',JSON.stringify(config,null,2));
  const allowedHosts=new Set([`${HOST}:${WEB_PORT}`,`localhost:${WEB_PORT}`]);
  server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${RPC}; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'`);
    if(!allowedHosts.has(req.headers.host)||req.method!=='GET'){res.writeHead(403);res.end('Local read-only server only');return;}
    const path=new URL(req.url,`http://${HOST}:${WEB_PORT}`).pathname;
    try{if(path==='/api/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return;}
      const file=({'/':'index.html','/index.html':'index.html','/app.js':'app.js','/app.js.map':'app.js.map','/style.css':'style.css','/favicon.svg':'favicon.svg'})[path];
      if(!file){if(path.startsWith('/api/')||/\.[^/]+$/.test(path)){res.writeHead(404);res.end('Not found');return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile('dist/index.html'));return;}
      res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.svg')?'image/svg+xml':'application/javascript');res.end(await readFile(`dist/${file}`));
    }catch(e){res.writeHead(500);res.end('Local file unavailable');}
  });
  server.listen(WEB_PORT,HOST,()=>{console.log(JSON.stringify({url:`http://${HOST}:${WEB_PORT}`,rpc:RPC,serverPid:process.pid,anvilPid:anvil.pid,session,token:config.token,factory:config.factory}));});
} catch(e){console.error(e);stop(1);}
