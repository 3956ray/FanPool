import {randomBytes,timingSafeEqual} from 'node:crypto';
import {fail} from './core.mjs';
export function parseCookies(raw=''){
  if(raw.length>8192)throw fail(400,'Cookie过长。');const cookies={};
  for(const part of raw.split(';')){const at=part.indexOf('=');if(at<0)continue;const name=part.slice(0,at).trim(),value=part.slice(at+1).trim();if(Object.hasOwn(cookies,name))throw fail(400,'重复Cookie。');cookies[name]=value;}return cookies;
}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function authHandler(service,origin){
  const url=new URL(origin),secure=url.protocol==='https:';
  if(!secure&&!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Auth requires HTTPS outside explicit localhost');
  const prefix=secure?'__Host-fp-':'fp-local-',names={sid:prefix+'session',csrf:prefix+'csrf',tx:prefix+'transaction'};
  const cookie=(name,value,age,httpOnly=true)=>`${name}=${value}; Path=/; Max-Age=${age}; SameSite=Strict${secure?'; Secure':''}${httpOnly?'; HttpOnly':''}`;
  return async(req,res,path)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      if(!service){res.writeHead(503);res.end(JSON.stringify({error:'身份服务待配置。'}));return;}
      const c=parseCookies(req.headers.cookie);let body={};
      if(req.method==='POST'){
        body=await protectedBody(req,origin,c[names.csrf]);
      }else if(req.method!=='GET')throw fail(405,'不支持的方法。');
      let result;
      if(path==='/api/auth/bootstrap'&&req.method==='GET'){
        const csrf=/^[a-f0-9]{64}$/.test(c[names.csrf]||'')?c[names.csrf]:randomBytes(32).toString('hex');const transaction=/^[a-f0-9]{64}$/.test(c[names.tx]||'')?c[names.tx]:randomBytes(32).toString('hex');res.setHeader('Set-Cookie',[cookie(names.csrf,csrf,3600,false),cookie(names.tx,transaction,86400)]);result={csrf};
      }else if(path==='/api/auth/challenge'&&req.method==='POST'){
        const transaction=c[names.tx];if(!/^[a-f0-9]{64}$/.test(transaction||''))throw fail(401,'请先初始化浏览器登录上下文。');result=await service.challenge(body.wallet,transaction,req.socket?.remoteAddress||'shared');res.setHeader('Set-Cookie',cookie(names.tx,transaction,86400));
      }else if(path==='/api/auth/complete'&&req.method==='POST'){
        if(!/^[a-f0-9]{64}$/.test(c[names.tx]||''))throw fail(401,'缺少登录事务。');
        const completed=await service.complete(body,c[names.tx]);res.setHeader('Set-Cookie',cookie(names.sid,completed.handle,86400));result=completed.identity;
      }else if(path==='/api/auth/session'&&req.method==='GET')result=await service.session(c[names.sid]);
      else if(path==='/api/auth/refresh'&&req.method==='POST')result=await service.session(c[names.sid],{refresh:true});
      else if(path==='/api/auth/logout'&&req.method==='POST'){await service.logout(c[names.sid],c[names.tx]);res.setHeader('Set-Cookie',cookie(names.sid,'',0));result={loggedOut:true};}
      else throw fail(404,'接口不存在。');
      res.end(JSON.stringify(result));
    }catch(e){res.writeHead(e.status||503);res.end(JSON.stringify({error:e.status?e.message:'身份服务暂不可用，请重新登录。'}));}
  };
}

export async function protectedBody(req,origin,csrf){
 if(req.headers.origin!==origin||req.headers['content-type']?.split(';')[0]!=='application/json'||!equal(csrf,req.headers['x-fanpool-csrf']))throw fail(403,'来源或CSRF校验失败。');
 let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192)throw fail(413,'请求过大。');}try{return JSON.parse(text);}catch{throw fail(400,'请求格式错误。');}
}
