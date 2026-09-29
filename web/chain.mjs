import {JsonRpcProvider,Contract,Interface,isAddress,keccak256} from 'ethers';
import ABI from './abi.json' with {type:'json'};
import {RPC,CHAIN_ID,validateNumbers,safeReference} from './domain.mjs';
export {ABI};
export function connect(){return new JsonRpcProvider(RPC,undefined,{cacheTimeout:-1,pollingInterval:250});}
export async function assertLocal(provider,cfg){
  if(cfg.rpc!==RPC||Number(cfg.chainId)!==CHAIN_ID||provider._getConnection().url!==RPC)throw new Error('已阻止非专用本机RPC。');
  const [chain,client,block,tcode,fcode,accounts]=await Promise.all([provider.send('eth_chainId',[]),provider.send('web3_clientVersion',[]),provider.send('eth_getBlockByNumber',[cfg.anchor.number,false]),provider.send('eth_getCode',[cfg.token,'latest']),provider.send('eth_getCode',[cfg.factory,'latest']),provider.send('eth_accounts',[])]);
  if(Number(chain)!==CHAIN_ID||!/anvil/i.test(client)||block?.hash!==cfg.anchor.hash||tcode==='0x'||fcode==='0x'||keccak256(tcode)!==cfg.codeHashes.token||keccak256(fcode)!==cfg.codeHashes.factory||cfg.roles.some((r,i)=>r.address.toLowerCase()!==accounts[i]?.toLowerCase()))throw new Error('本地链已重启、配置已变或合约不匹配。已阻止演示操作，请返回首页并重新加载。');
}
export async function chainNow(provider){return Number((await provider.send('eth_getBlockByNumber',['latest',false])).timestamp);}
export async function signerFor(provider,cfg,address){await assertLocal(provider,cfg);if(!cfg.roles.some(r=>r.address.toLowerCase()===address.toLowerCase()))throw new Error('只允许本地演示角色。');return provider.getSigner(address);}
export async function registeredPools(provider,cfg,blockTag='latest'){
  await assertLocal(provider,cfg);const f=new Contract(cfg.factory,ABI.FanPoolFactory,provider);const events=await f.queryFilter(f.filters.PoolCreated(),0,blockTag);
  return events.map(e=>({address:e.args.pool,organizer:e.args.organizer,hash:e.transactionHash,block:e.blockNumber})).reverse();
}
export async function requirePool(provider,cfg,address,blockTag='latest'){if(!isAddress(address))throw new Error('池地址格式不正确。');const list=await registeredPools(provider,cfg,blockTag);if(!list.some(p=>p.address.toLowerCase()===address.toLowerCase()))throw new Error('该地址不是当前本机工厂创建的池。链可能已经重置，请返回首页。');const p=new Contract(address,ABI.FanPool,provider);if((await p.factory({blockTag})).toLowerCase()!==cfg.factory.toLowerCase()||(await p.token({blockTag})).toLowerCase()!==cfg.token.toLowerCase())throw new Error('池的工厂或MOCK币配置不匹配。');return p;}
export async function receipt(tx,status){status?.('待确认',tx.hash);const r=await tx.wait();if(!r||r.status!==1)throw new Error('交易失败，链上状态没有完成预期改变。');return r;}
export async function createPool(provider,cfg,who,input,status){
  const signer=await signerFor(provider,cfg,who);const now=await chainNow(provider);const n=validateNumbers(input,now);safeReference(input.reference??'');
  for(const a of [input.supplier,input.fulfillment])if(!isAddress(a)||/^0x0{40}$/i.test(a)||a.toLowerCase()===who.toLowerCase())throw new Error('固定收款地址必须有效、非零，且不同于当前组织者。');
  const factory=new Contract(cfg.factory,ABI.FanPoolFactory,signer);status?.('待提交');
  const r=await receipt(await factory.createPool([input.supplier,input.fulfillment,n.I,n.R,n.F,n.lo,n.hi,...n.times]),status);
  const event=r.logs.map(l=>{try{return factory.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='PoolCreated');if(!event)throw new Error('回执中没有创建事件。');return {address:event.args.pool,hash:r.hash};
}
export async function transact(provider,cfg,who,address,method,args=[],status){
  const signer=await signerFor(provider,cfg,who);const p=(await requirePool(provider,cfg,address)).connect(signer);status?.('待提交');
  if(method==='join'){
    const token=new Contract(cfg.token,ABI.MockUSDC,signer);const amount=await p.commitment();if(await token.balanceOf(who)<amount)throw new Error('MOCK余额不足，可在本地演示工具中领取。');
    if(await token.allowance(who,address)<amount){status?.('待授权');await receipt(await token.approve(address,amount),status);await assertLocal(provider,cfg);status?.('待提交');}
  }
  const allowed=['join','exit','resolveFunding','paySupplier','expirePurchase','payFulfillment','closeNormal','abort','closeTimeout','claimRefundFor','claimFee'];if(!allowed.includes(method))throw new Error('不支持的资金操作。');
  return receipt(await p[method](...args),status);
}
export async function snapshot(provider,cfg,address){
  const block=await provider.send('eth_getBlockByNumber',['latest',false]);const blockTag=block.number;const p=await requirePool(provider,cfg,address,blockTag);const keys=['organizer','supplier','fulfillment','item','reserve','fee','commitment','min','max','fundingDeadline','purchaseDeadline','settlementDeadline','state','closeReason','failureReason','fundedCount','lockedN','s','fulfillmentExecuted','feeClaimed'];
  const values=await Promise.all(keys.map(k=>p[k]({blockTag})));const data=Object.fromEntries(keys.map((k,i)=>[k,values[i]]));
  const logs=await provider.getLogs({address,fromBlock:0,toBlock:blockTag});const events=logs.map(l=>{const e=p.interface.parseLog(l);return {name:e.name,args:e.args,hash:l.transactionHash,block:l.blockNumber,index:l.index};});
  const owners=[...new Set(events.filter(e=>e.name==='Joined').map(e=>e.args.owner))];
  const token=new Contract(cfg.token,ABI.MockUSDC,provider);const members=await Promise.all(owners.map(async owner=>({owner,active:await p.active(owner,{blockTag}),claimed:await p.claimed(owner,{blockTag})})));
  let liability=0n;for(const m of members)if(m.active){if(data.state<=1n)liability+=data.commitment;else if(data.state===2n)liability+=data.reserve-data.s+data.fee;else if(data.state===3n&&!m.claimed)liability+=data.commitment;else if(data.state===4n){if(!m.claimed)liability+=data.reserve-data.s;if(!data.feeClaimed)liability+=data.fee;}}
  const balance=await token.balanceOf(address,{blockTag});const paid=name=>events.filter(e=>e.name===name).reduce((n,e)=>n+e.args.amount,0n);
  const verifiedBlock=await provider.send('eth_getBlockByNumber',[blockTag,false]);if(verifiedBlock?.hash!==block.hash)throw new Error('读取期间本地链发生重置，请重新加载。');await assertLocal(provider,cfg);
  return {...data,address,members,events,balance,liability,blockNumber:Number(block.number),blockHash:block.hash,surplus:balance-liability,paidItem:paid('SupplierPaid'),paidShipping:paid('FulfillmentPaid'),refunded:paid('RefundClaimed'),paidFee:paid('FeeClaimed'),now:Number(block.timestamp)};
}
const ERRORS={WrongState:'当前链上状态不允许此操作。请刷新后重试。',WrongTime:'尚未到期限或操作期限已过。请按链上时间推进。',Unauthorized:'只有池的组织者可以执行这项操作。',InvalidMember:'该地址已加入，或没有当前池的退款权益。',AlreadyClaimed:'该权益已处理，不会重复支付。',FulfillmentRejected:'运费超过每地址预留上限，或运输付款已执行。未改变资金。',InvalidConfig:'池配置不符合固定资金规则。',InexactTransfer:'转账金额不精确，交易已回滚。'};
export function friendlyError(e){for(const d of [e?.data,e?.info?.error?.data?.data,e?.info?.error?.data])if(typeof d==='string'){try{const p=new Interface(ABI.FanPool).parseError(d);if(ERRORS[p?.name])return ERRORS[p.name]}catch{}}
  return e?.shortMessage||e?.message||'本地链操作失败，请检查服务后刷新。';
}
