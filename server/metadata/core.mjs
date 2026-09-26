import {getAddress} from 'ethers';
import {hash,fail} from '../auth/core.mjs';
import {normalizeMetadata} from '../../web/metadata.mjs';
const columns='chain_id,factory,pool,title,reference,created_at';
export class MetadataService{
 constructor({db,readDB=db,auth,chainId,factory,verifyPool}){Object.assign(this,{db,readDB,auth,chainId,verifyPool});this.factory=getAddress(factory).toLowerCase();}
 key(address){try{return [this.chainId,this.factory,getAddress(address).toLowerCase()];}catch{throw fail(400,'池地址格式无效。');}}
 async read(address){const r=await this.readDB.query(`SELECT ${columns} FROM fanpool_data.metadata WHERE chain_id=$1 AND factory=$2 AND pool=$3`,this.key(address));return r.rows[0]||null;}
 async publish(handle,address,body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['title','reference','creationTx'].includes(k)))throw fail(400,'不支持的资料字段。');
  let data;try{data=normalizeMetadata({title:body.title,reference:body.reference});}catch(e){throw fail(400,e.message);}
  if(!this.auth)throw fail(503,'身份服务暂不可用，资金池仍已创建。');
  const identity=await this.auth.session(handle),key=this.key(address),owner=await this.verifyPool(key[2],body.creationTx);
  if(identity.wallet.toLowerCase()!==owner||identity.chainId!==this.chainId)throw fail(403,'只有经验证的链上组织者可首次发布。');
  const conn=await this.db.connect();try{
   await conn.query('BEGIN');await conn.query("SET LOCAL lock_timeout='2s'");await conn.query("SET LOCAL statement_timeout='5s'");await conn.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
   const r=await conn.query('SELECT wallet,chain_id,revoked_at,expires_at,refresh_pending FROM fanpool_private.sessions WHERE handle_hash=$1 FOR UPDATE',[hash(handle)]),grant=r.rows[0];
   if(!grant||grant.revoked_at||grant.refresh_pending||new Date(grant.expires_at)<=new Date()||grant.wallet!==owner||Number(grant.chain_id)!==this.chainId)throw fail(401,'登录已过期或撤销，请重新登录后重试资料。');
   await conn.query('INSERT INTO fanpool_data.metadata(chain_id,factory,pool,title,reference) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[...key,data.title,data.reference]);
   const saved=(await conn.query(`SELECT ${columns} FROM fanpool_data.metadata WHERE chain_id=$1 AND factory=$2 AND pool=$3`,key)).rows[0];
   if(saved.title!==data.title||saved.reference!==data.reference)throw fail(409,'此池已首次发布其他内容，不能覆盖。');
   await conn.query('COMMIT');return saved;
  }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e;}finally{conn.release();}
 }
}
