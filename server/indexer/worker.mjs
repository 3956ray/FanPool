import {Interface} from 'ethers';import ABI from '../../web/abi.json' with {type:'json'};
const factoryABI=new Interface(ABI.FanPoolFactory),poolABI=new Interface(ABI.FanPool);
const hex=n=>'0x'+n.toString(16),encode=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
export async function runIndex(store,provider,cfg,{maxWindows=20,maxCalls=80,maxLogCalls=40,durationMs=14000}={}){
 const started=Date.now(),lease=await store.acquire();if(!lease)return {status:'busy-or-backoff',calls:0,windows:0};let calls=0,logCalls=0,windows=0,head;
 const rpc=async(method,args)=>{if(Date.now()-started>=durationMs||calls>=maxCalls||(method==='eth_getLogs'&&logCalls>=maxLogCalls))throw Error('BUDGET');calls++;if(method==='eth_getLogs')logCalls++;return provider.send(method,args);};
 const logs=(address,from,to,topics)=>rpc('eth_getLogs',[{address,fromBlock:hex(from),toBlock:hex(to),...(topics?{topics}: {})}]);
 try{
  if(Number(await rpc('eth_chainId',[]))!==cfg.chainId)throw Error('WRONG_CHAIN');head=Number((await rpc('eth_getBlockByNumber',['finalized',false])).number);
  if(lease.block_hash&&(await rpc('eth_getBlockByNumber',[hex(Number(lease.indexed_through)),false]))?.hash!==lease.block_hash)throw Error('FINALIZED_HASH_CHANGED');
  if(cfg.factoryDeploymentHash&&(await rpc('eth_getBlockByNumber',[hex(cfg.factoryDeploymentBlock),false]))?.hash!==cfg.factoryDeploymentHash)throw Error('FINALIZED_HASH_CHANGED');
  let from=Number(lease.indexed_through)+1,stage=lease.pending;
  while(from<=head&&windows<maxWindows){
   if(!stage){const to=Math.min(from+99,head),end=await rpc('eth_getBlockByNumber',[hex(to),false]),created=await logs(cfg.factory,from,to,[factoryABI.getEvent('PoolCreated').topicHash]);
    const pools=created.map(l=>{if(l.address.toLowerCase()!==cfg.factory.toLowerCase()||l.removed||Number(l.blockNumber)<from||Number(l.blockNumber)>to)throw Error('BAD_FACTORY_LOG');const e=factoryABI.parseLog(l);if(e.args.token.toLowerCase()!==cfg.token.toLowerCase())throw Error('BAD_FACTORY_TOKEN');return {pool:e.args.pool.toLowerCase(),token:e.args.token.toLowerCase(),organizer:e.args.organizer.toLowerCase(),creationTx:l.transactionHash,creationBlock:Number(l.blockNumber),creationHash:l.blockHash};});
    const addresses=[...new Set([...await store.poolAddresses(),...pools.map(p=>p.pool)])];if(addresses.length>200)throw Error('INDEX_CAPACITY');stage={from,to,hash:end.hash,head,pools,addresses,offset:0,batchSize:10,events:[]};await store.stage(lease.fence,stage);
   }
   if(stage.from!==from||(await rpc('eth_getBlockByNumber',[hex(stage.to),false]))?.hash!==stage.hash)throw Error('FINALIZED_HASH_CHANGED');
   while(stage.offset<stage.addresses.length){const addresses=stage.addresses.slice(stage.offset,stage.offset+stage.batchSize);let raw;try{raw=await logs(addresses,stage.from,stage.to);}catch(e){const code=e?.info?.error?.code??e.code;if((code===-32614||e?.info?.responseStatus===413||String(e.message).includes('413'))&&addresses.length>1){stage.batchSize=Math.max(1,Math.floor(stage.batchSize/2));await store.stage(lease.fence,stage);continue;}throw e;}
    const events=raw.map(l=>{if(l.removed||Number(l.blockNumber)<stage.from||Number(l.blockNumber)>stage.to||!addresses.includes(l.address.toLowerCase()))throw Error('BAD_POOL_LOG');const e=poolABI.parseLog(l);const args=Object.fromEntries(e.fragment.inputs.map((input,i)=>[input.name,e.args[i]]));return {pool:l.address.toLowerCase(),hash:l.transactionHash,index:Number(l.logIndex),block:Number(l.blockNumber),blockHash:l.blockHash,name:e.name,args:encode(args)};});
    if(stage.events.length+events.length>2000)throw Error('WINDOW_CAPACITY');stage.events.push(...events);stage.offset+=addresses.length;await store.stage(lease.fence,stage);
   }
   if((await rpc('eth_getBlockByNumber',[hex(stage.to),false]))?.hash!==stage.hash)throw Error('FINALIZED_HASH_CHANGED');
   await store.commit(lease.fence,stage.from,stage.to,stage.hash,head,stage.pools,stage.events);windows++;from=stage.to+1;stage=null;
  }
  await store.release(lease.fence,null,head);return {status:from>head?'caught-up':'bounded',calls,logCalls,windows,ms:Date.now()-started};
 }catch(e){const message=['BUDGET','STALE_LEASE','FINALIZED_HASH_CHANGED','WRONG_CHAIN','INDEX_CAPACITY','WINDOW_CAPACITY','BAD_FACTORY_LOG','BAD_FACTORY_TOKEN','BAD_POOL_LOG'].includes(e.message)?e.message:'RPC_OR_STORAGE_ERROR';await store.release(lease.fence,message,head);return {status:e.message==='BUDGET'?'bounded':message,calls,logCalls,windows,ms:Date.now()-started};}
}
