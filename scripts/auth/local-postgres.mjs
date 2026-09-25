import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createConnection} from 'node:net';
const bin='/opt/homebrew/opt/postgresql@17/bin',dir=resolve('.local/web2-postgres'),port=55473;
const occupied=await new Promise(r=>{const s=createConnection({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false));});if(occupied)throw Error('Dedicated auth port occupied; refusing unknown DB');
await mkdir(dir,{recursive:true});try{await readFile(`${dir}/PG_VERSION`);}catch{execFileSync(`${bin}/initdb`,['-D',dir,'--auth-local=trust','--auth-host=trust','-U','fanpool_test_admin','--encoding=UTF8','--locale=C'],{stdio:'inherit'});}
const child=spawn(`${bin}/postgres`,['-D',dir,'-h','127.0.0.1','-p',String(port),'-k',dir],{stdio:'inherit'});
process.on('SIGINT',()=>child.kill('SIGTERM'));process.on('SIGTERM',()=>child.kill('SIGTERM'));process.on('exit',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code||0));console.log(JSON.stringify({ownerPid:process.pid,postgresPid:child.pid,port,dataDirectory:dir,scope:'disposable local auth tests only'}));
