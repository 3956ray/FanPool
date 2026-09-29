import {Contract,Interface,getAddress} from 'ethers';
import ABI from './abi.json' with {type:'json'};
const fail=(status,message)=>Object.assign(Error(message),{status});
export function sourceVerifier(provider,config){
 const factory=getAddress(config.factory).toLowerCase(),token=getAddress(config.token).toLowerCase(),iface=new Interface(ABI.FanPoolFactory);
 return async(pool,creationTx)=>{
  if(!/^0x[0-9a-f]{64}$/i.test(creationTx||''))throw fail(400,'缺少有效创建交易提示。');
  if(Number(await provider.send('eth_chainId',[]))!==config.chainId)throw fail(503,'链配置不匹配。');
  const receipt=await provider.getTransactionReceipt(creationTx);
  if(!receipt||receipt.status!==1)throw fail(409,'创建回执尚未成功确认，请稍后仅重试资料。');
  const event=receipt.logs.filter(l=>l.address.toLowerCase()===factory).map(l=>{try{return iface.parseLog(l);}catch{return null;}}).find(e=>e?.name==='PoolCreated'&&e.args.pool.toLowerCase()===pool&&e.args.token.toLowerCase()===token);
  if(!event)throw fail(403,'创建记录不属于指定工厂和资金池。');
  const finalized=await provider.send('eth_getBlockByNumber',['finalized',false]);
  if(!finalized||Number(finalized.number)<receipt.blockNumber)throw fail(409,'创建交易待最终确认，请稍后仅重试资料。');
  const blockTag='0x'+receipt.blockNumber.toString(16),block=await provider.send('eth_getBlockByNumber',[blockTag,false]);
  if(!block||block.hash!==receipt.blockHash)throw fail(409,'创建区块已变化，请核对原交易。');
  const stateTag=finalized.number;const contract=new Contract(pool,ABI.FanPool,provider);
  const [f,t,organizer]=await Promise.all(['factory','token','organizer'].map(name=>contract[name]({blockTag:stateTag})));
  if(f.toLowerCase()!==factory||t.toLowerCase()!==token||organizer.toLowerCase()!==event.args.organizer.toLowerCase())throw fail(403,'池合约来源不一致。');
  if((await provider.send('eth_getBlockByNumber',[stateTag,false]))?.hash!==finalized.hash)throw fail(409,'读取期间区块变化。');
  return {organizer:organizer.toLowerCase(),factory,token,pool,creationTx,creationBlock:receipt.blockNumber,creationHash:receipt.blockHash,verifiedAt:Number(finalized.number)};
 };
}
