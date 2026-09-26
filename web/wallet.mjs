import {BrowserProvider,getAddress} from 'ethers';
// Pure controller is tested with injected EIP-1193 providers. UI binds real AppKit.
export function walletController(){
  let state={address:null,chainId:null,provider:null,epoch:0},listeners=[];
  const emit=()=>listeners.forEach(fn=>fn({...state}));
  return {get:()=>({...state}),subscribe(fn){listeners.push(fn);return ()=>listeners=listeners.filter(f=>f!==fn);},
    update({address,chainId,provider}){address=address?getAddress(address):null;chainId=chainId?Number(chainId):null;if(address!==state.address||chainId!==state.chainId||provider!==state.provider){state={address,chainId,provider,epoch:state.epoch+1};emit();}},
    async guard(expected){const s=state;if(!s.provider||!s.address)throw Error('请先连接钱包。');if(s.chainId!==10143)throw Error('请切换到 Monad 测试网。');if(expected&&(s.epoch!==expected.epoch||s.provider!==expected.provider))throw Error('钱包或网络已改变，已停止后续操作。');const [accounts,chain]=await Promise.all([s.provider.request({method:'eth_accounts'}),s.provider.request({method:'eth_chainId'})]);if(state.epoch!==s.epoch||Number(chain)!==10143||accounts[0]?.toLowerCase()!==s.address.toLowerCase())throw Error('钱包或网络已改变，已停止后续操作。');return {...s};},
    async signer(expected){const s=await this.guard(expected);const signer=await new BrowserProvider(s.provider).getSigner(s.address);await this.guard(s);return signer;}
  };
}
export const wallet=walletController();
let modal;
export async function setupWallet(projectId){
  if(modal)return modal;
  const [{createAppKit},{EthersAdapter},{monadTestnet}]=await Promise.all([import('@reown/appkit'),import('@reown/appkit-adapter-ethers'),import('@reown/appkit/networks')]);
  modal=createAppKit({adapters:[new EthersAdapter()],networks:[monadTestnet],projectId,metadata:{name:'FanPool',description:'MOCK group purchasing protocol',url:location.origin,icons:[]},features:{analytics:false,email:false,socials:false,swaps:false,onramp:false}});
  const sync=()=>{const a=modal.getAccount('eip155');wallet.update({address:a?.isConnected?a.address:null,chainId:modal.getChainId(),provider:modal.getWalletProvider()});};
  modal.subscribeAccount(sync,'eip155');modal.subscribeNetwork(sync);modal.subscribeProviders(sync);sync();return modal;
}
export async function confirmed(tx,status){status?.('待确认，请勿重复提交',tx.hash);try{const r=await tx.wait();if(!r||r.status!==1)throw Error('交易失败，请核对链上回执。');return r;}catch(e){if(e.code==='TRANSACTION_REPLACED'){status?.(e.cancelled?'交易已取消':'交易已替换',e.replacement?.hash||e.receipt?.hash);if(!e.cancelled&&e.reason==='repriced'&&e.receipt?.status===1)return e.receipt;throw Error('交易被取消或替换为不同操作，请核对新交易后刷新。');}throw e;}}
