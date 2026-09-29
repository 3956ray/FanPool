import {createClient} from '@supabase/supabase-js';
// auth-js retries retryable fetch errors even with autoRefreshToken:false.
// A request-scoped deadline and non-retryable transport failure prevent that.
export function authFactory(url,key,{fetchImpl=fetch,timeoutMs=4000}={}){
  return ()=>{
    const deadline=Date.now()+timeoutMs;
    const failure=()=>new Response(JSON.stringify({message:'Identity transport unavailable; start a new login.',code:'fanpool_transport_failed'}),{status:400,headers:{'content-type':'application/json'}});
    const boundedFetch=async(url,options={})=>{
      const remaining=deadline-Date.now();if(remaining<=0)return failure();
      const abort=new AbortController();let timer;
      try{return await Promise.race([
        fetchImpl(url,{...options,signal:abort.signal}).then(async r=>{if(r.status>=500)return failure();const body=await r.arrayBuffer();return new Response(body,{status:r.status,headers:r.headers});}).catch(()=>failure()),
        new Promise(r=>{timer=setTimeout(()=>{abort.abort();r(failure());},remaining);})
      ]);}finally{clearTimeout(timer);}
    };
    return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFetch}}).auth;
  };
}
