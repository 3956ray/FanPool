import {JsonRpcProvider,Contract,Interface,isAddress,keccak256} from 'ethers';
import ABI from './abi.json' with {type:'json'};
import {validateNumbers,safeReference} from './domain.mjs';
import {sourceVerifier} from './source.mjs';
import {wallet,confirmed} from './wallet.mjs';
export {ABI};
let readProvider;
export function configure(cfg){if(!cfg.rpc||new URL(cfg.rpc).protocol!=='https:')throw Error('测试网RPC需HTTPS。');readProvider=new JsonRpcProvider(cfg.rpc,10143,{cacheTimeout:-1});}

export function connect(){return new Proxy({}, {get:(_,key)=>{if(!readProvider)throw Error('部署待配置。');const value=readProvider[key];return typeof value==='function'?value.bind(readProvider):value;}});}
export async function assertLocal(provider,cfg){
  if(cfg.mode!=='public'||Number(cfg.chainId)!==10143||!cfg.factory||!cfg.token)throw Error('部署待配置。');
  if(Number(await provider.send('eth_chainId',[]))!==10143)throw Error('只读RPC不是Monad测试网。');
  if(await provider.getCode(cfg.factory)==='0x'||await provider.getCode(cfg.token)==='0x')throw Error('测试网合约地址未部署。');
}
export async function chainNow(provider){return Number((await provider.send('eth_getBlockByNumber',['latest',false])).timestamp);}
export async function signerFor(provider,cfg,address){await assertLocal(provider,cfg);const s=await wallet.guard();if(s.address.toLowerCase()!==address.toLowerCase())throw Error('钱包地址已改变。');return wallet.signer(s);}
const sources=new Map();
export function rememberSource(cfg,address,creationTx){if(/^0x[0-9a-f]{64}$/i.test(creationTx||''))sources.set(`${cfg.session}:${address.toLowerCase()}`,creationTx);}
export async function indexList(cfg,{owner,kind='all',before}={}){const query=new URLSearchParams({kind,...(owner?{owner}:{}),...(before?{before}:{})});const r=await fetch('/api/index/pools?'+query,{cache:'no-store',signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error('共享历史目录暂不可用；可用池地址和创建交易直接打开。');const result=await r.json();for(const row of result.items)rememberSource(cfg,row.pool,row.creation_tx);return result;}
export async function indexDetail(address){try{const r=await fetch(`/api/index/pools/${address}`,{cache:'no-store',signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error();return await r.json();}catch{return null;}}
export async function registeredPools(provider,cfg){const result=await indexList(cfg);return result.items.map(r=>({address:r.pool,organizer:r.organizer,hash:r.creation_tx,block:Number(r.creation_block)}));}
export async function requirePool(provider,cfg,address,creationTx){if(!isAddress(address))throw Error('池地址格式不正确。');creationTx=creationTx||sources.get(`${cfg.session}:${address.toLowerCase()}`);if(!creationTx)throw Object.assign(Error('缺少创建交易定位信息，请输入原创建交易哈希；不会扫描整条链或信任池自报来源。'),{code:'SOURCE_REQUIRED'});await assertLocal(provider,cfg);await sourceVerifier(provider,cfg)(address.toLowerCase(),creationTx);rememberSource(cfg,address,creationTx);return new Contract(address,ABI.FanPool,provider);}
export const receipt=confirmed;
export async function createPool(provider,cfg,who,input,status){
  const identity=await wallet.guard();const signer=await signerFor(provider,cfg,who);const now=await chainNow(provider);const n=validateNumbers(input,now);safeReference(input.reference??'');
  for(const a of [input.supplier,input.fulfillment])if(!isAddress(a)||/^0x0{40}$/i.test(a)||a.toLowerCase()===who.toLowerCase())throw new Error('固定收款地址必须有效、非零，且不同于当前组织者。');
  const factory=new Contract(cfg.factory,ABI.FanPoolFactory,signer);status?.('待提交');
  await wallet.guard(identity);const r=await receipt(await factory.createPool([input.supplier,input.fulfillment,n.I,n.R,n.F,n.lo,n.hi,...n.times]),status);
  const event=r.logs.map(l=>{try{return factory.interface.parseLog(l)}catch{return null}}).find(l=>l?.name==='PoolCreated');if(!event)throw new Error('回执中没有创建事件。');rememberSource(cfg,event.args.pool,r.hash);return {address:event.args.pool,hash:r.hash};
}
export async function transact(provider,cfg,who,address,method,args=[],status,creationTx){
  const identity=await wallet.guard();const signer=await signerFor(provider,cfg,who);const p=(await requirePool(provider,cfg,address,creationTx)).connect(signer);status?.('待提交');
  if(method==='join'){
    const token=new Contract(cfg.token,ABI.MockUSDC,signer);const amount=await p.commitment();if(await token.balanceOf(who)<amount)throw new Error('MOCK余额不足，请使用已批准的测试币领取途径。');
    if(await token.allowance(who,address)<amount){status?.('待授权');await wallet.guard(identity);await receipt(await token.approve(address,amount),status);await assertLocal(provider,cfg);await wallet.guard(identity);status?.('待提交');}
  }
  if(method==='payFulfillment'&&(args[0]<0n||args[0]>await p.reserve()))throw Error('运费超过每地址预留上限，未发送交易。');
  const allowed=['join','exit','resolveFunding','paySupplier','expirePurchase','payFulfillment','closeNormal','abort','closeTimeout','claimRefundFor','claimFee'];if(!allowed.includes(method))throw new Error('不支持的资金操作。');
  await wallet.guard(identity);return receipt(await p[method](...args),status);
}
export async function snapshot(provider,cfg,address,{creationTx,beneficiary,history=null}={}){
 const p=await requirePool(provider,cfg,address,creationTx);const block=await provider.send('eth_getBlockByNumber',['latest',false]),blockTag=block.number;
 const keys=['organizer','supplier','fulfillment','item','reserve','fee','commitment','min','max','fundingDeadline','purchaseDeadline','settlementDeadline','state','closeReason','failureReason','fundedCount','lockedN','s','fulfillmentExecuted','feeClaimed'];
 const values=await Promise.all(keys.map(k=>p[k]({blockTag}))),data=Object.fromEntries(keys.map((k,i)=>[k,values[i]]));
 const owners=[...new Set([...(history?.owners||[]),...(beneficiary&&isAddress(beneficiary)?[beneficiary]:[])].filter(isAddress).map(a=>a.toLowerCase()))];
 const members=await Promise.all(owners.map(async owner=>({owner,active:await p.active(owner,{blockTag}),claimed:await p.claimed(owner,{blockTag})})));
 const events=(history?.events||[]).filter(e=>Number(e.block)<=Number(block.number)).map(e=>({...e,block:Number(e.block),args:Object.fromEntries(Object.entries(e.args).map(([k,v])=>[k,typeof v==='string'&&/^\d+$/.test(v)?BigInt(v):v]))}));
 const historyComplete=!!history?.membersComplete&&!!history?.eventsComplete&&Number(history.sync?.indexed_through)>=Number(block.number);
 const terminalCoverage=data.state>=3n&&BigInt(members.filter(m=>m.active).length)===data.lockedN;
 let liability=null;if(data.state===0n)liability=data.fundedCount*data.commitment;else if(data.state===1n)liability=data.lockedN*data.commitment;else if(data.state===2n)liability=data.lockedN*(data.reserve-data.s+data.fee);else if(terminalCoverage){liability=BigInt(members.filter(m=>m.active&&!m.claimed).length)*(data.state===3n?data.commitment:data.reserve-data.s);}
 if(typeof liability==='number')liability=BigInt(liability);if(terminalCoverage&&data.state===4n&&!data.feeClaimed)liability+=data.lockedN*data.fee;
 const balance=await new Contract(cfg.token,ABI.MockUSDC,provider).balanceOf(address,{blockTag});
 if((await provider.send('eth_getBlockByNumber',[blockTag,false]))?.hash!==block.hash)throw Error('读取期间区块变化，请刷新。');
 return {...data,address,members,events,historyComplete,sync:history?.sync||null,balance,liability,surplus:liability===null?null:balance-liability,terminalCoverage,historicalRefunded:history?.eventsComplete?events.filter(e=>e.name==='RefundClaimed').reduce((n,e)=>n+e.args.amount,0n):null,refunded:data.state<3n?0n:terminalCoverage?BigInt(members.filter(m=>m.active&&m.claimed).length)*(data.state===3n?data.commitment:data.reserve-data.s):null,paidItem:data.state===2n||data.state===4n?data.item*data.lockedN:0n,paidShipping:data.s*data.lockedN,paidFee:data.feeClaimed?data.fee*data.lockedN:0n,blockNumber:Number(block.number),blockHash:block.hash,now:Number(block.timestamp)};
}
const ERRORS={WrongState:'当前链上状态不允许此操作。请刷新后重试。',WrongTime:'尚未到期限或操作期限已过。请按链上时间推进。',Unauthorized:'只有池的组织者可以执行这项操作。',InvalidMember:'该地址已加入，或没有当前池的退款权益。',AlreadyClaimed:'该权益已处理，不会重复支付。',FulfillmentRejected:'运费超过每地址预留上限，或运输付款已执行。未改变资金。',InvalidConfig:'池配置不符合固定资金规则。',InexactTransfer:'转账金额不精确，交易已回滚。'};
export function friendlyError(e){for(const d of [e?.data,e?.info?.error?.data?.data,e?.info?.error?.data])if(typeof d==='string'){try{const p=new Interface(ABI.FanPool).parseError(d);if(ERRORS[p?.name])return ERRORS[p.name]}catch{}}
  return e?.shortMessage||e?.message||'测试网操作失败，请检查服务后刷新。';
}
