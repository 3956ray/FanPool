export const RPC = 'http://127.0.0.1:8547';
export const CHAIN_ID = 31338;
export const MAX_UINT256 = (1n << 256n) - 1n;
export function parseAmount(value) {
  const s=String(value).trim();
  if(!/^\d+(\.\d{1,6})?$/.test(s)) throw new Error('请输入非负金额，最多 6 位小数；不接受指数或逗号。');
  const [whole,fraction='']=s.split('.'); const n=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
  if(n>MAX_UINT256) throw new Error('金额超过合约整数上限。'); return n;
}
export function formatAmount(n) {n=BigInt(n);const frac=(n%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return `${n/1000000n}${frac?'.'+frac:''}`;}
export function safeReference(value) {if(!value.trim())return '';const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw new Error('商品参考链接只允许 http 或 https。');return u.href;}
export function esc(value) {return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function validateNumbers({item,reserve,fee,min,max,funding,purchase,settlement},now) {
  const I=parseAmount(item),R=parseAmount(reserve),F=parseAmount(fee);
  if(I===0n)throw new Error('商品单价必须大于 0。');
  if(!/^\d+$/.test(String(min))||!/^\d+$/.test(String(max)))throw new Error('出资地址数必须是整数。');
  const lo=BigInt(min),hi=BigInt(max);if(lo<1n||hi>1000n||lo>hi)throw new Error('地址数须满足 1 ≤ 最少 ≤ 最多 ≤ 1000。');
  if((I+R+F)*hi>MAX_UINT256)throw new Error('最高承诺与最大地址数的乘积超出合约范围。');
  const times=[funding,purchase,settlement].map(Number);
  if(times.some(t=>!Number.isSafeInteger(t))||!(Number(now)<times[0]&&times[0]<times[1]&&times[1]<times[2]))throw new Error('期限必须满足：链上当前时间 < 集资截止 < 采购截止 < 结算截止。');
  return {I,R,F,lo,hi,times};
}
export const STATES=['FUNDING','READY','PURCHASED','FAILED','CLOSED'];
export const STATE_LABELS=['集资中','已锁定 · 待采购','已采购 · 待结算','未采购 · 全额退款','已关闭 · 可结算'];
export const CLOSE=['未关闭','正常关闭（非交付认证）','组织者主动终止','结算超时关闭'];
export const FAIL=['无','未达到最少出资地址数','采购期限已过'];
export function phaseActions(p,now,who) {
  const organizer=who.toLowerCase()===p.organizer.toLowerCase();const phase=Number(p.state);
  return {join:phase===0&&now<p.fundingDeadline,exit:phase===0&&now<p.fundingDeadline,resolve:phase===0&&now>=p.fundingDeadline,
    purchase:phase===1&&organizer&&now<p.purchaseDeadline,expire:phase===1&&now>=p.purchaseDeadline,
    ship:phase===2&&organizer&&now<p.settlementDeadline&&!p.fulfillmentExecuted,
    close:phase===2&&organizer&&now<p.settlementDeadline,timeout:phase===2&&now>=p.settlementDeadline,claim:phase===3||phase===4,fee:phase===4&&!p.feeClaimed};
}
