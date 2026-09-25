import {IndexStore} from './indexer/store.mjs';
import {runIndex} from './indexer/worker.mjs';
import {indexHandler,workerHandler} from './indexer/http.mjs';
import {boundedRPC} from './indexer/rpc.mjs';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {Pool} from 'pg';
import {JsonRpcProvider,FetchRequest} from 'ethers';
import {MetadataService} from './metadata/core.mjs';
import {chainVerifier} from './metadata/verify.mjs';
import {metadataHandler} from './metadata/http.mjs';
import {AuthService} from './auth/core.mjs';
import {authFactory} from './auth/supabase.mjs';
import {authHandler} from './auth/http.mjs';
const origin=process.env.APP_ORIGIN||'http://127.0.0.1:4174',host=new URL(origin).host;
const config={mode:'public',chainId:10143,projectId:process.env.REOWN_PROJECT_ID||'5e8dc9a12760df99a9e35d05e2c5ef57',rpc:process.env.PUBLIC_RPC_URL||'https://testnet-rpc.monad.xyz',factory:process.env.PUBLIC_FACTORY||'',token:process.env.PUBLIC_TOKEN||'',supplier:process.env.PUBLIC_SUPPLIER||'',fulfillment:process.env.PUBLIC_FULFILLMENT||'',roles:[],factoryDeploymentBlock:Number(process.env.PUBLIC_FACTORY_DEPLOYMENT_BLOCK||0),factoryDeploymentHash:process.env.PUBLIC_FACTORY_DEPLOYMENT_HASH||''};
config.deployed=!!(config.factory&&config.token&&config.supplier&&config.fulfillment);config.session=`monad-10143-${config.factory||'pending'}`;
const authFields=['AUTH_DATABASE_URL','AUTH_TOKEN_KEY','SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY'];if(authFields.some(k=>process.env[k])&&!authFields.every(k=>process.env[k]))throw Error('Incomplete server auth configuration');
const configured=!!(process.env.AUTH_DATABASE_URL&&process.env.AUTH_TOKEN_KEY&&process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY);
const db=configured?new Pool({connectionString:process.env.AUTH_DATABASE_URL,max:2,idleTimeoutMillis:5000,connectionTimeoutMillis:2000,statement_timeout:10000}):null;
const authService=configured?new AuthService({db,origin,key:process.env.AUTH_TOKEN_KEY,authFactory:authFactory(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY)}):null;
const auth=authHandler(authService,origin);
const readDB=process.env.METADATA_READ_DATABASE_URL?new Pool({connectionString:process.env.METADATA_READ_DATABASE_URL,max:2,idleTimeoutMillis:5000,connectionTimeoutMillis:2000,statement_timeout:3000}):null;
if(config.deployed&&(!Number.isSafeInteger(config.factoryDeploymentBlock)||config.factoryDeploymentBlock<1||!/^0x[0-9a-f]{64}$/i.test(config.factoryDeploymentHash)))throw Error('Verified factory deployment block/hash required');
config.metadataEnabled=true;
const transport=new FetchRequest(config.rpc);transport.timeout=5000;if(new URL(config.rpc).protocol!=='https:')throw Error('Public RPC must use HTTPS');
const rpc=config.deployed?new JsonRpcProvider(transport,10143,{cacheTimeout:-1}):null;
const metadata=metadataHandler(config.deployed&&(readDB||db)?new MetadataService({db,readDB:readDB||db,auth:authService,chainId:10143,factory:config.factory,verifyPool:chainVerifier(rpc,config)}):null,origin);
const indexReadDB=process.env.INDEX_READ_DATABASE_URL?new Pool({connectionString:process.env.INDEX_READ_DATABASE_URL,max:2,idleTimeoutMillis:5000,connectionTimeoutMillis:2000,statement_timeout:3000}):null;
const indexWriteDB=process.env.INDEX_WORKER_DATABASE_URL?new Pool({connectionString:process.env.INDEX_WORKER_DATABASE_URL,max:1,idleTimeoutMillis:5000,connectionTimeoutMillis:2000,statement_timeout:2000}):null;
const index=indexHandler(config.deployed&&indexReadDB?new IndexStore(indexReadDB,config):null);
const worker=workerHandler(async()=>{if(!config.deployed||!indexWriteDB)throw Error('worker unconfigured');return runIndex(new IndexStore(indexWriteDB,config),boundedRPC(config.rpc,Date.now()+14000),config);},process.env.INDEX_WORKER_SECRET);
export async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:; img-src 'self' https: data:; font-src 'self' https://fonts.reown.com https://fonts.walletconnect.com data:; frame-src https:; base-uri 'none'; frame-ancestors 'none'");
  if(req.headers.host!==host){res.writeHead(403);res.end('Origin not configured');return;}
  const path=new URL(req.url,origin).pathname;
  if(path==='/api/internal/index')return worker(req,res);
  if(path==='/api/index/pools'||/^\/api\/index\/pools\/[^/]+$/.test(path))return index(req,res,path,new URL(req.url,origin));
  if(path.startsWith('/api/auth/'))return auth(req,res,path);
  if(/^\/api\/pools\/[^/]+\/metadata$/.test(path))return metadata(req,res,path.split('/')[3]);
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(path==='/api/config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return;}
  if(path.startsWith('/api/')){res.writeHead(404);res.end();return;}
  const asset=/\.[^/]+$/.test(path);const file=resolve('dist-public',asset?'.'+path:'index.html'),root=resolve('dist-public')+sep;
  if(!file.startsWith(root)){res.writeHead(404);res.end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8');res.end(await readFile(file));}catch{res.writeHead(404);res.end('Not found');}
}
if(process.argv[1]===new URL(import.meta.url).pathname){const server=createServer(handler);server.listen(4174,'127.0.0.1',()=>console.log(JSON.stringify({pid:process.pid,url:'http://127.0.0.1:4174',mode:'public',deployed:config.deployed,authConfigured:configured})));const stop=()=>server.close(async()=>{await db?.end();await readDB?.end();await indexReadDB?.end();await indexWriteDB?.end();rpc?.destroy();process.exit(0)});process.on('SIGINT',stop);process.on('SIGTERM',stop);}
