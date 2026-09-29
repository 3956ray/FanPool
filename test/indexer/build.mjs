import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
export async function buildTest(){
await build({entryPoints:['web/app.mjs'],bundle:true,format:'esm',outfile:'.local/web4-dist/app.js',define:{PUBLIC:'true'},plugins:[{name:'TEST-only-public-adapter',setup(b){b.onLoad({filter:/web\/app\.mjs$/},async a=>({contents:(await readFile(a.path,'utf8')).replace(/^const PUBLIC=.*;\n/,''),loader:'js'}));b.onResolve({filter:/^\.\/chain\.mjs$/},()=>({path:new URL('../../web/chain-public.mjs',import.meta.url).pathname}));b.onResolve({filter:/^\.\/wallet\.mjs$/},()=>({path:new URL('./wallet-adapter.mjs',import.meta.url).pathname}));b.onLoad({filter:/web\/chain-public\.mjs$/},async a=>({contents:(await readFile(a.path,'utf8')).replace("new URL(cfg.rpc).protocol!=='https:'","cfg.rpc!=='http://127.0.0.1:8549'"),loader:'js'}));}}]});
}
if(process.argv[1]===new URL(import.meta.url).pathname)await buildTest();
