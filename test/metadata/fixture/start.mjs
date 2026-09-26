// TEST ONLY. Not a production entry point; loopback chain 31339 and separate DB.
import {spawn} from 'node:child_process';
import {createConnection} from 'node:net';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {Pool} from 'pg';
import {JsonRpcProvider,ContractFactory,keccak256} from 'ethers';
import {build} from 'esbuild';
import {MetadataService} from '../../../server/metadata/core.mjs';
import {chainVerifier} from '../../../server/metadata/verify.mjs';
import {metadataHandler} from '../../../server/metadata/http.mjs';
import {hash,fail} from '../../../server/auth/core.mjs';
for(const port of [8548,4175])if(await new Promise(r=>{const s=createConnection({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();r(true);});s.once('error',()=>r(false));}))throw Error(`Test port ${port} occupied`);
const base={host:'127.0.0.1',port:55473,user:'fanpool_test_admin'};
const cluster=new Pool({...base,database:'postgres'});if(!(await cluster.query("SELECT 1 FROM pg_database WHERE datname='fanpool_web3_test'")).rowCount)await cluster.query('CREATE DATABASE fanpool_web3_test');await cluster.end();
const admin=new Pool({...base,database:'fanpool_web3_test'});await admin.query('DROP SCHEMA IF EXISTS fanpool_private CASCADE');await admin.query('DROP SCHEMA IF EXISTS fanpool_data CASCADE');await admin.query(await readFile('server/auth/schema/auth.sql','utf8'));await admin.query(await readFile('server/metadata/schema/metadata.sql','utf8'));
await admin.query("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='fanpool_web3_app') THEN CREATE ROLE fanpool_web3_app NOLOGIN; END IF; END $$; GRANT fanpool_auth,fanpool_metadata_writer TO fanpool_web3_app;");
const db=new Pool({...base,database:'fanpool_web3_test',options:'-c role=fanpool_web3_app'});
const anvil=spawn(process.env.HOME+'/.foundry/bin/anvil',['--host','127.0.0.1','--port','8548','--chain-id','31339','--block-time','1','--silent'],{stdio:'ignore'});
let server,provider,closing=false;async function stop(){if(closing)return;closing=true;server?.close();anvil.kill('SIGTERM');provider?.destroy();await db.end();await admin.end();process.exit(0);}process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('exit',()=>anvil.kill('SIGTERM'));
const rpc='http://127.0.0.1:8548';for(let i=0;i<100;i++){try{await fetch(rpc,{method:'POST',body:'{}'});break;}catch{await new Promise(r=>setTimeout(r,50));}}
provider=new JsonRpcProvider(rpc,31339,{cacheTimeout:-1,pollingInterval:50});
const accounts=await provider.send('eth_accounts',[]),signer=await provider.getSigner(accounts[0]);
const deploy=async name=>{const a=JSON.parse(await readFile(`out/${name}.sol/${name}.json`));return new ContractFactory(a.abi,a.bytecode.object,signer);};
const token=await(await deploy('MockUSDC')).deploy();await token.waitForDeployment();const factory=await(await deploy('FanPoolFactory')).deploy(await token.getAddress());await factory.waitForDeployment();
for(const a of accounts.slice(0,5))await(await token.mint(a,1000000000n)).wait();
const anchor=await provider.send('eth_getBlockByNumber',['latest',false]);
const config={metadataEnabled:true,rpc,chainId:31339,session:randomUUID(),token:await token.getAddress(),factory:await factory.getAddress(),anchor:{number:anchor.number,hash:anchor.hash},codeHashes:{token:keccak256(await provider.getCode(await token.getAddress())),factory:keccak256(await provider.getCode(await factory.getAddress()))},roles:accounts.slice(0,5).map((address,i)=>({address,name:['TEST组织者','TEST小雨','TEST阿星','TEST可可','TEST旁观者'][i]})),supplier:accounts[5],fulfillment:accounts[6]};
const handle=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
// Stub replaces Hosted Auth only in this isolated fixture. Final grant check remains real SQL.
await db.query('INSERT INTO fanpool_private.sessions(sid,uid,wallet,chain_id,login_hash,handle_hash,tokens,expires_at) VALUES($1,$2,$3,31339,$4,$5,$6,now()+interval \'1 day\')',[randomUUID(),randomUUID(),accounts[0].toLowerCase(),hash('fixture'),hash(handle),Buffer.from('NO_AUTH_TOKEN_TEST_STUB')]);
const auth={async session(h){const r=(await db.query('SELECT * FROM fanpool_private.sessions WHERE handle_hash=$1',[hash(h||'')])).rows[0];if(!r||r.revoked_at||new Date(r.expires_at)<=new Date())throw fail(401,'TEST身份无效');return {wallet:r.wallet,chainId:Number(r.chain_id)};}};
let rpcFailNext=false;const diagnostics={rpcErrors:[],responseDrops:[],errorResponses:[]},verify=chainVerifier(provider,config);
const service=new MetadataService({db,auth,chainId:31339,factory:config.factory,verifyPool:async(...args)=>{try{if(rpcFailNext){rpcFailNext=false;throw Object.assign(Error('TEST controlled RPC rejection'),{code:'CALL_EXCEPTION',shortMessage:'TEST missing revert data'});}return await verify(...args);}catch(e){diagnostics.rpcErrors.push({code:e.code||null,shortMessage:e.shortMessage||null,rpcCode:e.info?.error?.code||null,rpcMessage:e.info?.error?.message?.slice(0,300)||null});throw e;}}});
const metadata=metadataHandler(service,'http://127.0.0.1:4175');
await mkdir('.local/web3-dist',{recursive:true});
await build({entryPoints:['web/app.mjs'],bundle:true,format:'esm',outfile:'.local/web3-dist/app.js',define:{__PUBLIC__:'false'},plugins:[{name:'TEST-only-local-chain',setup(b){b.onLoad({filter:/web\/domain\.mjs$/},async a=>({contents:(await readFile(a.path,'utf8')).replaceAll('8547','8548').replaceAll('31338','31339'),loader:'js'}));b.onLoad({filter:/web\/app\.mjs$/},async a=>({contents:(await readFile(a.path,'utf8')).replace('init();',`authAPI={get:()=>({wallet:S.config?.roles[0].address}),async publish(address,body){const r=await fetch('/api/pools/'+address+'/metadata',{method:'POST',headers:{'content-type':'application/json','x-fanpool-csrf':document.cookie.split('; ').find(s=>s.startsWith('fp-local-csrf='))?.split('=')[1]},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}};init();`),loader:'js'}));}}]});
await writeFile('.local/web3-config.json',JSON.stringify(config,null,2));
let outage=false,failNext=false,loseNext=false;
server=createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');if(req.headers.host!=='127.0.0.1:4175'){res.writeHead(403).end();return;}const path=new URL(req.url,'http://127.0.0.1:4175').pathname;
 if(path==='/test/control'&&req.method==='POST'){if(req.headers.origin!=='http://127.0.0.1:4175'){res.writeHead(403).end();return;}let raw='';for await(const chunk of req)raw+=chunk;const c=JSON.parse(raw);outage=!!c.outage;failNext=!!c.failNext;loseNext=!!c.loseNext;rpcFailNext=!!c.rpcFailNext;res.end('{}');return;}
 if(path==='/test/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(diagnostics));return;}
 if(path==='/test/login'){res.setHeader('Set-Cookie',[`fp-local-session=${handle}; HttpOnly; Path=/; SameSite=Strict`,`fp-local-csrf=${csrf}; Path=/; SameSite=Strict`]);res.end('TEST ONLY: Hosted Auth stub login. Go to /create');return;}
 if(path==='/api/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return;}
 if(/^\/api\/pools\/[^/]+\/metadata$/.test(path)){if(outage||(failNext&&req.method==='POST')){failNext=false;res.writeHead(503,{'content-type':'application/json'}).end('{"error":"TEST资料服务故障"}');return;}if(loseNext&&req.method==='POST'){const end=res.end.bind(res);res.end=data=>{if(res.statusCode>=200&&res.statusCode<300){const saved=JSON.parse(data);if(!saved.pool||!saved.created_at)throw Error('TEST loss requires a committed metadata result');loseNext=false;diagnostics.responseDrops.push({pool:saved.pool,created_at:saved.created_at,status:res.statusCode});res.destroy();return res;}diagnostics.errorResponses.push({status:res.statusCode});return end(data);};await metadata(req,res,path.split('/')[3]);return;}return metadata(req,res,path.split('/')[3]);}
 if(req.method!=='GET'||path.startsWith('/api/')){res.writeHead(404).end();return;}try{const file=path==='/app.js'?'.local/web3-dist/app.js':path==='/style.css'?'web/style.css':'web/index.html';res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});server.listen(4175,'127.0.0.1',()=>console.log(JSON.stringify({testOnly:true,pid:process.pid,anvilPid:anvil.pid,url:'http://127.0.0.1:4175',rpc,session:config.session,auth:'STUB; no production bypass',db:'fanpool_web3_test'})));
