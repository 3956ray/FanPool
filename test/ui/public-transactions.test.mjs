import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {isAddress} from 'ethers';
import {walletController} from '../../web/wallet.mjs';
import {validateNumbers,safeReference} from '../../web/domain.mjs';
const source=(await readFile(new URL('../../web/chain-public.mjs',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace('export {ABI};','').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export const','const');
const owner='0x'+'12'.repeat(20),other='0x'+'34'.repeat(20),target='0x'+'56'.repeat(20);
function setup(){let address=owner,chain='0x279f',calls=0,approvals=0;const wallet=walletController();const provider={request:async({method})=>method==='eth_accounts'?[address]:chain};wallet.update({address,chainId:10143,provider});const token={balanceOf:async()=>15000000n,allowance:async()=>0n,approve:async()=>{approvals++;address=other;return {hash:'approval',wait:async()=>({status:1})};},createPool:async()=>{calls++;return {};}};const ctx=vm.createContext({wallet,ABI:{},Contract:class{constructor(){return token;}},confirmed:async tx=>tx.wait(),validateNumbers,safeReference,isAddress});vm.runInContext(source,ctx);ctx.setChanged=()=>address=other;ctx.p={connect(){return this;},commitment:async()=>15000000n,join:async()=>{calls++;}};vm.runInContext('signerFor=async()=>({});assertLocal=async()=>{};requirePool=async()=>p;',ctx);return {ctx,token,changeAccount:()=>address=other,changeChain:()=>chain='0x1',approvals:()=>approvals,run:s=>vm.runInContext(s,ctx),calls:()=>calls};}
test('actual public create guard catches account change during async pre-submit reads',async()=>{const h=setup();h.ctx.input={item:'10',reserve:'4',fee:'1',min:'1',max:'2',funding:2000,purchase:3000,settlement:4000,supplier:other,fulfillment:target};h.ctx.owner=owner;h.run('chainNow=async()=>{setChanged();return 1000;}');await assert.rejects(h.run('createPool({}, {factory:"factory"},owner,input)'));assert.equal(h.calls(),0);});
test('actual public join never follows approval after provider account changes',async()=>{const h=setup();h.ctx.owner=owner;await assert.rejects(h.run('transact({}, {token:"token"},owner,"pool","join")'));assert.equal(h.calls(),0);});

for(const read of ['balanceOf','allowance'])for(const change of ['changeAccount','changeChain'])test(`no approve or join after ${change} during delayed ${read}`,async()=>{
  const h=setup();let resume,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>resume=r);
  h.token[read]=async()=>{entered();await gate;return read==='balanceOf'?15000000n:0n;};h.ctx.owner=owner;
  const pending=h.run('transact({}, {token:"token"},owner,"pool","join")');await started;h[change]();resume();await assert.rejects(pending);
  assert.equal(h.approvals(),0);assert.equal(h.calls(),0);
});
