// Explicit public tree: original product source, reproducibility files, selected original fixtures.
import {readdir,readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const files=['LICENSE','.gitignore','.env.example','README.md','DEMO.md','dependencies.lock.json','foundry.toml','package.json','pnpm-lock.yaml','vercel.json','docs/WEB3-EXTERNAL-GATE.md','docs/WEB4-GATE.md','docs/WEB4-REPORT.md'];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isSymbolicLink())throw Error('No symlinks in publish tree: '+p);if(e.isDirectory())await walk(p);else files.push(p);}}
for(const dir of ['api','src','server','web','scripts','test'])await walk(dir);
for(const file of ['contracts.json','local-gas.json','cron.sql'])files.push('docs/deployment/'+file);
for(const file of ['run-1.json','run-2.json','seed-1.json','seed-2.json','replay-summary.json'])files.push('docs/evidence/cp3/'+file);
const entries=[];for(const path of [...new Set(files)].sort()){const data=await readFile(path);entries.push({path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});}
await writeFile('docs/deployment/publish-manifest.json',JSON.stringify({status:'PROPOSED_NOT_PUBLISHED',rule:'Only these files; excludes secrets, local config/build outputs, third-party full-text research. Manifest itself is local review metadata, not part of target tree.',files:entries},null,2));console.log(JSON.stringify({files:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0)}));
