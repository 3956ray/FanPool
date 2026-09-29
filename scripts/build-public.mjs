import {build} from 'esbuild';
import {rm,mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
await rm('dist-public',{recursive:true,force:true});await mkdir('dist-public',{recursive:true});
await build({entryPoints:{app:'web/app.mjs',setup:'web/setup.mjs'},bundle:true,format:'esm',splitting:true,outdir:'dist-public',entryNames:'[name]',chunkNames:'chunks/[name]-[hash]',target:['es2022'],minify:true,define:{PUBLIC:'true'},metafile:true,plugins:[{name:'isolate-public-chain',setup(b){b.onLoad({filter:/web\/app\.mjs$/},async args=>({contents:(await readFile(args.path,'utf8')).replace(/^const PUBLIC=.*;\n/,''),loader:'js'}));b.onResolve({filter:/^\.\/chain\.mjs$/},()=>({path:new URL('../web/chain-public.mjs',import.meta.url).pathname}));}}]}).then(r=>writeFile('dist-public/metafile.json',JSON.stringify(r.metafile,null,2)));
for(const file of ['index.html','style.css','favicon.svg','setup.html','setup.css'])await copyFile(`web/${file}`,`dist-public/${file}`);
const meta=JSON.parse(await readFile('dist-public/metafile.json'));if(Object.keys(meta.inputs).some(x=>x==='web/chain.mjs'||x.startsWith('server/')))throw Error('Public build includes private/local chain module');
console.log('Public build complete: locked ABI, no Foundry/Anvil/server imports.');
