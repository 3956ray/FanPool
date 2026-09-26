import test from 'node:test';
import assert from 'node:assert/strict';
import {authFactory} from '../../server/auth/supabase.mjs';
test('real pinned Supabase SDK refresh has total transport deadline and no retries',async()=>{for(const kind of ['hang','body-hang','500','throw']){let calls=0;const client=authFactory('https://example.supabase.co','public-test-only',{timeoutMs:30,fetchImpl:async()=>{calls++;if(kind==='hang')return new Promise(()=>{});if(kind==='body-hang')return new Response(new ReadableStream({start(){}}));if(kind==='500')return new Response('{}',{status:503});throw Error('network');}})();const start=Date.now();const result=await client.refreshSession({refresh_token:'local-test-only'});assert.ok(result.error);assert.ok(Date.now()-start<500);assert.equal(calls,1);}});
