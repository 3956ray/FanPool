import {wallet} from './wallet.mjs';
let csrf=null,identity=null,generation=0,loginPending=null;
const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('fanpool-auth'):null;
const listeners=[];function emit(){listeners.forEach(fn=>fn(identity));}
function browserCSRF(){if(typeof document==='undefined')return csrf;const name=location.protocol==='https:'?'__Host-fp-csrf':'fp-local-csrf';return document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||null;}
async function bootstrap(){const run=async()=>{csrf=browserCSRF();if(csrf)return;const r=await fetch('/api/auth/bootstrap',{credentials:'same-origin',cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error);csrf=data.csrf;};
  if(typeof document!=='undefined'){if(!navigator.locks)throw Error('登录需要支持Web Locks的安全浏览器。');await navigator.locks.request('fanpool-auth-bootstrap',run);}else await run();
}
async function request(path,body,beforeSend){if(body){csrf=browserCSRF();if(!csrf)await bootstrap();csrf=browserCSRF()||csrf;}

  if(beforeSend)await beforeSend();
  const r=await fetch(path.startsWith('/')?path:'/api/auth/'+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:body?{'content-type':'application/json','x-fanpool-csrf':csrf}:{},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'身份服务不可用'),{status:r.status});return data;
}
export const authUI={async publish(address,body){const current=generation,s=await wallet.guard();if(!identity||identity.wallet.toLowerCase()!==s.address.toLowerCase())throw Error('请先签名登录，再重试资料保存。');const result=await request(`/api/pools/${address}/metadata`,body,async()=>{await wallet.guard(s);if(current!==generation)throw Error('身份已改变，请重新确认资料发布。');});await wallet.guard(s);return result;},get:()=>identity,subscribe(fn){listeners.push(fn);},async restore(){const current=++generation,s=wallet.get();identity=null;emit();if(!s.address||s.chainId!==10143)return;try{let user;try{user=await request('session');}catch(e){if(e.status!==401)throw e;user=await request('refresh',{});}if(current===generation&&s.epoch===wallet.get().epoch&&user.wallet.toLowerCase()===s.address.toLowerCase()){identity=user;emit();}else if(current===generation&&s.epoch===wallet.get().epoch)await request('logout',{});}catch{if(current===generation){identity=null;emit();}}},
  async login(){if(loginPending)throw Error('登录确认处理中，请勿重复请求。');loginPending=this.performLogin();try{return await loginPending;}finally{loginPending=null;}},
  async performLogin(){const current=++generation,s=await wallet.guard();identity=null;emit();const c=await request('challenge',{wallet:s.address});if(current!==generation)throw Error('登录已取消。');const signer=await wallet.signer(s);const signature=await signer.signMessage(c.message);await wallet.guard(s);if(current!==generation)throw Error('登录已取消。');const user=await request('complete',{nonce:c.nonce,message:c.message,signature});if(current!==generation||s.epoch!==wallet.get().epoch){await request('logout',{});throw Error('钱包已改变，登录已撤销。');}identity=user;emit();channel?.postMessage('changed');return user;},
  async logout(){generation++;identity=null;emit();await request('logout',{});channel?.postMessage('changed');}
};
wallet.subscribe(()=>{generation++;identity=null;emit();authUI.restore();});
if(channel)channel.onmessage=()=>authUI.restore();
