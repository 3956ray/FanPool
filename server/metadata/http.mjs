import {parseCookies,protectedBody} from '../auth/http.mjs';
import {fail} from '../auth/core.mjs';
export function metadataHandler(service,origin){
 const prefix=new URL(origin).protocol==='https:'?'__Host-fp-':'fp-local-';
 return async(req,res,address)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');try{
  if(!service)throw fail(503,'商品资料服务暂不可用；链上政策与退款不受影响。');
  let result;if(req.method==='GET')result=await service.read(address);
  else if(req.method==='POST'){const cookies=parseCookies(req.headers.cookie);const body=await protectedBody(req,origin,cookies[prefix+'csrf']);result=await service.publish(cookies[prefix+'session'],address,body);}
  else throw fail(405,'商品资料仅支持读取及首次发布。');
  res.end(JSON.stringify(result));
 }catch(e){res.writeHead(e.status||503);res.end(JSON.stringify({error:e.status?e.message:'商品资料服务暂不可用，请仅重试资料保存。'}));}};
}
