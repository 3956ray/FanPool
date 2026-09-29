import {build} from 'esbuild';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
const abi={};for(const name of ['FanPool','FanPoolFactory','MockUSDC'])abi[name]=JSON.parse(await readFile(`out/${name}.sol/${name}.json`,'utf8')).abi;
await writeFile('web/abi.json',JSON.stringify(abi));await mkdir('dist',{recursive:true});
await build({entryPoints:['web/app.mjs'],bundle:true,format:'esm',target:['es2022'],minify:false,sourcemap:true,outfile:'dist/app.js',define:{PUBLIC:'false'},plugins:[{name:'isolate-local-app',setup(b){b.onLoad({filter:/web\/app\.mjs$/},async args=>({contents:(await readFile(args.path,'utf8')).replace(/^const PUBLIC=.*;\n/,''),loader:'js'}));}}]});
for(const file of ['index.html','style.css','favicon.svg'])await copyFile(`web/${file}`,`dist/${file}`);
console.log('FanPool local web build complete.');
