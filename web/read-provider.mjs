import {JsonRpcProvider} from 'ethers';
const READ_ONLY=new Set(['eth_chainId','eth_blockNumber','eth_getCode','eth_getBlockByNumber','eth_getBlockByHash','eth_getTransactionReceipt','eth_getTransactionByHash','eth_call','eth_getLogs','eth_getTransactionCount','eth_gasPrice','eth_maxPriorityFeePerGas','eth_estimateGas']);
const shared=new Map();
export function readQueue({fetcher=fetch,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),spacing=125,maxPending=64,maxWait=15000,timeout=7000}={}){
 let tail=Promise.resolve(),pending=0,nextStart=0;
 return function request(url,payload){
  if(!READ_ONLY.has(payload.method))return Promise.reject(Error('Read provider refuses non-read RPC method'));
  if(pending>=maxPending)return Promise.reject(Error('只读RPC请求过多，请稍后刷新。'));
  pending++;const deadline=now()+maxWait;
  const job=tail.then(async()=>{
   for(let attempt=0;attempt<3;attempt++){
    if(now()>=deadline)throw Error('只读RPC排队已过期，请重新刷新。');
    const wait=Math.max(0,nextStart-now());if(now()+wait>=deadline)throw Error('只读RPC排队已过期，请重新刷新。');
    if(wait)await sleep(wait);
    if(now()>=deadline)throw Error('只读RPC排队已过期，请重新刷新。');
    nextStart=now()+spacing;
    const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(Math.max(1,Math.min(timeout,deadline-now())))});
    let result;
    if(response.status===429)await response.body?.cancel();
    if(response.status!==429){if(!response.ok)throw Error(`只读RPC HTTP ${response.status}`);result=await response.json();}
    const limited=response.status===429||result?.error?.code===-32011;
    if(!limited)return result;
    if(attempt===2){if(result)return result;throw Error('只读RPC限流，请稍后刷新。');}
    // Retry starts are queued too; no burst after a 429 or -32011.
    nextStart=Math.max(nextStart,now()+500*(attempt+1));
   }
  });
  tail=job.catch(()=>{});return job.finally(()=>pending--);
 };
}
export class PublicReadProvider extends JsonRpcProvider{
 constructor(url,{queue}={}){if(new URL(url).protocol!=='https:')throw Error('Read RPC requires HTTPS');super(url,10143,{cacheTimeout:-1});this.endpoint=url;if(!queue){if(!shared.has(url))shared.set(url,readQueue());queue=shared.get(url);}this.enqueue=queue;}
 async _send(payload){const entries=Array.isArray(payload)?payload:[payload];return Promise.all(entries.map(entry=>this.enqueue(this.endpoint,entry)));}
}
