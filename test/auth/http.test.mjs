import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {authHandler,parseCookies} from '../../server/auth/http.mjs';
test('cookie parser rejects duplicate and oversized values',()=>{assert.throws(()=>parseCookies('x=a;x=b'));assert.throws(()=>parseCookies('x'.repeat(8193)));assert.equal(parseCookies('a=1; b=2').b,'2');});
test('HTTP enforces Origin/CSRF/size and exposes only opaque HttpOnly session',async()=>{
  const handle='a'.repeat(64);const service={challenge:async()=>({nonce:'n',message:'m'}),complete:async()=>({handle,identity:{wallet:'0xabc',chainId:10143}}),logout:async()=>{},session:async()=>({wallet:'0xabc',chainId:10143})};
  let origin;const server=createServer((req,res)=>authHandler(service,origin)(req,res,new URL(req.url,origin).pathname));await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  try{const bootstrap=await fetch(origin+'/api/auth/bootstrap'),csrf=(await bootstrap.json()).csrf;assert.match(bootstrap.headers.get('set-cookie'),/SameSite=Strict/);const headers={'content-type':'application/json',origin,'x-fanpool-csrf':csrf,cookie:`fp-local-csrf=${csrf}; fp-local-transaction=${handle}`};
  const post=(path,overrides={},body='{}')=>fetch(origin+'/api/auth/'+path,{method:'POST',headers:{...headers,...overrides},body});
  assert.equal((await post('complete',{origin:'https://evil.test'})).status,403);assert.equal((await post('challenge',{'x-fanpool-csrf':'bad'})).status,403);assert.equal((await post('complete',{},'x'.repeat(8193))).status,413);
  const ok=await post('complete');assert.equal(ok.status,200);assert.match(ok.headers.get('set-cookie'),/HttpOnly/);assert.ok(!(await ok.text()).includes(handle));
  const secure=authHandler(service,'https://fan-pool-eta.vercel.app');let cookies;const req={method:'POST',headers:{origin:'https://fan-pool-eta.vercel.app','content-type':'application/json','x-fanpool-csrf':csrf,cookie:`__Host-fp-csrf=${csrf}; __Host-fp-transaction=${handle}`},async *[Symbol.asyncIterator](){yield '{}';}};await secure(req,{setHeader(k,v){if(k==='Set-Cookie')cookies=v;},end(){},writeHead(code){assert.equal(code,200);}},'/api/auth/complete');assert.ok([cookies].flat().every(c=>c.includes('Secure')&&c.includes('Path=/')&&!c.includes('Domain=')));
  }finally{await new Promise(r=>server.close(r));}
});
