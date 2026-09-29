export function normalizeMetadata(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['title','reference'].includes(k)))throw Error('资料只允许标题和参考链接。');
  if(typeof input.title!=='string'||typeof input.reference!=='string')throw Error('标题与链接必须为文本。');
  const title=input.title.normalize('NFC').trim().replace(/\s+/gu,' ');
  if(!title||[...title].length>120||/[<>\u0000-\u001f\u007f]/u.test(input.title))throw Error('标题需为1–120字，不含HTML或控制字符。');
  let reference=input.reference.trim();if(reference){if(reference.length>2048||/[<>\u0000-\u0020\u007f]/u.test(reference))throw Error('参考链接格式无效或过长。');let u;try{u=new URL(reference);}catch{throw Error('参考链接格式无效。');}if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('参考链接只接受不含账户密码的http/https。');reference=u.href;if(reference.length>2048)throw Error('参考链接最长2048字符。');}
  return {title,reference};
}
export async function readMetadata(address,fetcher=fetch){try{const r=await fetcher(`/api/pools/${encodeURIComponent(address)}/metadata`,{cache:'no-store',signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error();return {status:'ready',data:await r.json()};}catch{return {status:'unavailable',data:null};}}
// A receipt is durable before metadata is attempted. Retry never invokes create.
const volatileReceipts=new Map();
export function publication(storage,key){
  const read=()=>{if(volatileReceipts.has(key))return volatileReceipts.get(key);try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}};
  const save=(value,required=false)=>{try{storage.setItem(key,JSON.stringify(value));volatileReceipts.delete(key);}catch(e){if(required)throw Error('无法保存本机草稿，尚未发送创建交易。');value={...value,storageWarning:'浏览器存储不可用，仅当前页面保留原池；关闭前请复制池地址和交易哈希。'};volatileReceipts.set(key,value);}return value;};
  return {read,async create(input,create,publish){const previous=read();if(previous?.address&&!previous.published)throw Error('原资金池已创建，请仅重试资料保存。');const draft=save({draft:normalizeMetadata(input),published:false},true);const receipt=await create();const record=save({...draft,...receipt});return this.retry(publish,record);},async retry(publish,record=read()){if(!record?.address||!record.hash)throw Error('没有可重试的已创建资金池。');try{const result=await publish(record);save({...record,published:true,result});return {...record,metadataPending:false};}catch(e){save({...record,error:e.message});return {...record,metadataPending:true};}}};
}
