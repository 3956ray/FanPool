import {isAddress} from 'ethers';
export function routeURL(path,session,creationTx){return `${path}?session=${encodeURIComponent(session)}${creationTx?`&creationTx=${encodeURIComponent(creationTx)}`:''}`;}
export function readRoute(href,session){
  const url=new URL(href,'http://127.0.0.1:4173');
  if(url.searchParams.has('session')&&url.searchParams.get('session')!==session)return {view:'error',title:'旧模拟会话已结束',message:'此链接属于另一条本机模拟链，已阻止读取与交易。请明确返回当前链首页。'};
  let path=url.pathname;
  if(path==='/'&&url.searchParams.has('pool'))path=`/pools/${url.searchParams.get('pool')}`;
  const views={'/':'home','/create':'create','/my':'my','/manage':'manage'};
  if(views[path])return {view:views[path],path};
  if(path.startsWith('/pools/')&&path.split('/').length===3){
    const address=path.slice(7);
    if(!isAddress(address))return {view:'error',title:'池地址格式不正确',message:'请使用完整、有效的 0x 池地址。'};
    const creationTx=url.searchParams.get('creationTx')||undefined;if(creationTx&&!/^0x[0-9a-f]{64}$/i.test(creationTx))return {view:'error',title:'创建交易格式不正确',message:'请提供完整创建交易哈希。'};return {view:'pool',path,address,...(creationTx?{creationTx}:{})};
  }
  return {view:'error',title:'404 · 页面不存在',message:'该路径没有对应页面，请使用导航或返回首页。'};
}
// Only the latest route / role / refresh request may publish its result.
export function latestRequest(){let version=0;return {invalidate:()=>++version,begin(){const id=++version;return ()=>id===version;}};}
export function participation(pool,address){
  const same=a=>a?.toLowerCase()===address.toLowerCase();
  if(!pool.participated&&!pool.events.some(e=>e.name==='Joined'&&same(e.args.owner)))return null;
  const member=pool.members.find(m=>same(m.owner));
  if(!member?.active)return {label:'已退出 · 无当前权益',kind:'exited'};
  if(member.claimed)return {label:(pool.state===4n&&pool.reserve===pool.s)?'零额权益已处理 · 无待领款':'已退款 · 无待领款',kind:'claimed'};
  if(pool.state>=3n)return {label:pool.state===4n&&pool.reserve===pool.s?'零额权益待处理':'待领取退款',kind:'claimable',amount:pool.state===3n?pool.commitment:pool.reserve-pool.s};
  return {label:pool.state===0n?'当前出资 · 锁定前可退出':'当前出资 · 资金已锁定',kind:'active'};
}
