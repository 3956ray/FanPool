import {AbiCoder,Interface,getAddress,keccak256,getCreateAddress} from 'ethers';
import artifacts from './setup-artifacts.json' with {type:'json'};
export const SETUP={chainId:10143,rpc:'https://testnet-rpc.monad.xyz',projectId:'5e8dc9a12760df99a9e35d05e2c5ef57',sender:getAddress('0xC4F8a468f10d5f98DCfF3282516125E97F26433b'),beneficiaryB:getAddress('0xcc5C1ce846c0302ab27a4811cf2e0E6FC7282952')};
export const STEPS=['token','factory','mintA','mintB'];
const tokenABI=new Interface(artifacts.MockUSDC.abi),factoryABI=new Interface(artifacts.FanPoolFactory.abi),same=(a,b)=>a?.toLowerCase()===b?.toLowerCase(),hex=n=>'0x'+BigInt(n).toString(16),HASH=/^0x[0-9a-f]{64}$/i;
export const SETUP_KEY='fanpool-setup-v1:'+keccak256(artifacts.MockUSDC.creationBytecode+artifacts.FanPoolFactory.creationBytecode.slice(2))+':'+SETUP.sender+':'+SETUP.beneficiaryB;
export function encodeSetup(step,token){if(!STEPS.includes(step))throw Error('未知部署步骤');let tx={from:SETUP.sender,chainId:hex(SETUP.chainId),value:'0x0'};if(step==='token')tx.data=artifacts.MockUSDC.creationBytecode;else if(step==='factory')tx.data=artifacts.FanPoolFactory.creationBytecode+AbiCoder.defaultAbiCoder().encode(['address'],[getAddress(token)]).slice(2);else Object.assign(tx,{to:getAddress(token),data:tokenABI.encodeFunctionData('mint',[step==='mintA'?SETUP.sender:SETUP.beneficiaryB,1000000000n])});return tx;}
function runtime(name,token){const a=artifacts[name];let code=a.runtimeBytecode.slice(2);if(name==='FanPoolFactory'){const value=getAddress(token).slice(2).toLowerCase().padStart(64,'0');for(const refs of Object.values(a.immutableReferences))for(const r of refs){if(r.length!==32)throw Error('固定artifact immutable范围不符');code=code.slice(0,r.start*2)+value+code.slice((r.start+r.length)*2);}}return '0x'+code;}
const pending=message=>Object.assign(Error(message),{pending:true});
export async function verifySetup(rpc,step,record,token){
 if(!HASH.test(record.hash||''))throw Error('需要完整交易哈希');
 if(Number(await rpc.send('eth_chainId',[]))!==SETUP.chainId)throw Error('RPC网络不是Monad测试网');
 const [tx,receipt]=await Promise.all([rpc.send('eth_getTransactionByHash',[record.hash]),rpc.send('eth_getTransactionReceipt',[record.hash])]);
 if(!tx||!receipt)throw pending('原交易回执尚未知；仅可继续核验，不会重新发送。');
 const expected=encodeSetup(step,token);if(!same(tx.hash,record.hash)||!same(receipt.transactionHash,record.hash)||!same(tx.from,SETUP.sender)||!same(receipt.from,SETUP.sender)||Number(tx.chainId)!==SETUP.chainId||BigInt(tx.value)!==0n||!same(tx.input,expected.data)|| (expected.to?!same(tx.to,expected.to)||!same(receipt.to,expected.to):!!tx.to||!!receipt.to)|| (record.nonce!==undefined&&BigInt(tx.nonce)!==BigInt(record.nonce)))throw Error('交易发送人/链/目标/金额/编码/nonce与批准步骤不一致');
 if(Number(receipt.status)!==1)throw Error('原交易失败；已停止后续步骤，请保留哈希核查，不自动重发。');
 const finalized=await rpc.send('eth_getBlockByNumber',['finalized',false]);if(!finalized||Number(finalized.number)<Number(receipt.blockNumber))throw pending('原交易已入块，等待finalized；不会重发。');
 const block=await rpc.send('eth_getBlockByNumber',[receipt.blockNumber,false]);if(!same(block?.hash,receipt.blockHash)||!same(tx.blockHash,receipt.blockHash))throw Error('原交易区块hash不一致');
 let address,balance;
 if(step==='token'||step==='factory'){
  address=getAddress(receipt.contractAddress);if(!same(address,getCreateAddress({from:SETUP.sender,nonce:BigInt(tx.nonce)})))throw Error('部署地址与发送人nonce不一致');
  const code=await rpc.send('eth_getCode',[address,finalized.number]);if(keccak256(code)!==keccak256(runtime(step==='token'?'MockUSDC':'FanPoolFactory',token)))throw Error('部署runtime与冻结artifact不一致');
  if(step==='factory'){const value=await rpc.send('eth_call',[{to:address,data:factoryABI.encodeFunctionData('token')},finalized.number]);if(!same(factoryABI.decodeFunctionResult('token',value)[0],token))throw Error('Factory绑定Token不符');}
 }else{
  const recipient=step==='mintA'?SETUP.sender:SETUP.beneficiaryB;
  const code=await rpc.send('eth_getCode',[token,finalized.number]);if(keccak256(code)!==keccak256(runtime('MockUSDC')))throw Error('Token runtime已不匹配');
  const event=receipt.logs.filter(l=>same(l.address,token)).map(l=>{try{return tokenABI.parseLog(l);}catch{return null;}}).find(e=>e?.name==='Transfer'&&BigInt(e.args.from)===0n&&same(e.args.to,recipient)&&e.args.value===1000000000n);if(!event)throw Error('缺少固定受益人的1000 MOCK铸造事件');
  balance=tokenABI.decodeFunctionResult('balanceOf',await rpc.send('eth_call',[{to:token,data:tokenABI.encodeFunctionData('balanceOf',[recipient])},finalized.number]))[0].toString();
 }
 if(!same((await rpc.send('eth_getBlockByNumber',[finalized.number,false]))?.hash,finalized.hash))throw pending('读取期间finalized区块变化，请重验原交易');
 return {hash:record.hash,address,nonce:tx.nonce,block:Number(receipt.blockNumber),blockHash:receipt.blockHash,finalized:Number(finalized.number),balance};
}
export function setupController({rpc,wallet,storage,locks=globalThis.navigator?.locks,now=()=>Date.now()}){
 const volatile=new Map();let busy=false,prepared=null;const verified={};
 function persisted(){const raw=storage.getItem(SETUP_KEY);if(!raw)return {};const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('部署恢复记录格式错误');return data;}
 function read(){const data=persisted();for(const [step,patch] of volatile)if(JSON.stringify(data[step])===patch.base)data[step]=structuredClone(patch.value);return data;}
 // Every call is inside the shared lock. Merge only this step into fresh storage;
 // an old volatile snapshot never replaces another tab's newer records.
 function save(step,value,required=false){const durable=persisted(),data=read();data[step]=value;try{storage.setItem(SETUP_KEY,JSON.stringify(data));volatile.clear();}catch(e){if(required)throw Error('无法保存发送意图，已在钱包请求前停止。');volatile.set(step,{base:JSON.stringify(durable[step]),value:structuredClone(value)});return '浏览器未保存新哈希；请复制交易哈希。刷新后必须手工恢复，不能再次发送。';}}
 async function exclusive(fn){if(busy)throw Error('已有操作处理中');if(!locks?.request)throw Error('当前浏览器缺少跨标签安全锁；请使用支持Web Locks的浏览器。');busy=true;try{return await locks.request(SETUP_KEY,{ifAvailable:true},async lock=>{if(!lock)throw Error('另一标签正在提交或核验，请稍后重试');return fn();});}finally{busy=false;}}
 async function validatePrior(step){const data=read(),index=STEPS.indexOf(step);for(const previous of STEPS.slice(0,index)){if(!data[previous]?.hash)throw Error('请先完成并核验前一步');verified[previous]=await verifySetup(rpc,previous,data[previous],verified.token?.address);}return verified.token?.address;}
 async function identity(expected){const current=await wallet.guard(expected);if(!same(current.address,SETUP.sender))throw Error('本批准流程由钱包A发送；钱包B仅接收MOCK。');return current;}
 return {
  read,verified,get busy(){return busy;},get prepared(){return prepared;},invalidate(){prepared=null;},
  async prepare(step){if(busy)throw Error('已有操作处理中');const record=read()[step];if(record&&record.phase!=='rejected')throw Error('此步已有发送意图或原交易，只能核验/恢复，不得重复发送');const id=await identity(),token=await validatePrior(step),tx=encodeSetup(step,token);const [gas,gasPrice,nonce]=await Promise.all([rpc.send('eth_estimateGas',[tx]),rpc.send('eth_gasPrice',[]),rpc.send('eth_getTransactionCount',[SETUP.sender,'pending'])]);await identity(id);prepared={step,identity:id,tx:{...tx,gas:hex((BigInt(gas)*12n+9n)/10n),gasPrice,nonce},gasEstimate:gas,feeMaximum:(BigInt(hex((BigInt(gas)*12n+9n)/10n))*BigInt(gasPrice)).toString(),dataHash:keccak256(tx.data),at:now()};return prepared;},
  async submit(step){return exclusive(async()=>{
   const plan=prepared;if(!plan||plan.step!==step||now()-plan.at>90000)throw Error('请重新准备本步并核对当前费用');const data=read();if(data[step]&&data[step].phase!=='rejected')throw Error('已存在原交易意图，禁止重复发送');await validatePrior(step);await identity(plan.identity);
   const [gas,price,nonce]=await Promise.all([rpc.send('eth_estimateGas',[plan.tx]),rpc.send('eth_gasPrice',[]),rpc.send('eth_getTransactionCount',[SETUP.sender,'pending'])]);if(BigInt(gas)>BigInt(plan.tx.gas)||BigInt(price)>BigInt(plan.tx.gasPrice)||BigInt(nonce)!==BigInt(plan.tx.nonce))throw Error('当前费用或nonce变化，请重新准备核对');await identity(plan.identity);
   data[step]={phase:'awaiting-wallet',nonce:plan.tx.nonce,from:SETUP.sender,dataHash:plan.dataHash,startedAt:now()};save(step,data[step],true);prepared=null;
   try{const hash=await plan.identity.provider.request({method:'eth_sendTransaction',params:[plan.tx]});if(!HASH.test(hash||''))throw Error('钱包返回未知交易结果');data[step]={...data[step],phase:'submitted',hash};const warning=save(step,data[step]);return {hash,warning};}
   catch(e){data[step]={...data[step],phase:Number(e.code)===4001?'rejected':'unknown'};save(step,data[step]);throw e;}
  });},
  async check(step,manualHash){return exclusive(async()=>{const data=read(),existing=data[step];const hash=manualHash||existing?.hash;if(!HASH.test(hash||''))throw Error('请输入原交易哈希');const token=await validatePrior(step);const candidate={...existing,phase:'submitted',hash};for(const later of STEPS.slice(STEPS.indexOf(step)))delete verified[later];const result=await verifySetup(rpc,step,candidate,token);verified[step]=result;data[step]={phase:'submitted',hash,nonce:result.nonce,from:SETUP.sender,address:result.address};const warning=save(step,data[step]);return {...result,warning};});}
 };
}
