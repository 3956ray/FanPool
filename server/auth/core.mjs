import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {getAddress,verifyMessage} from 'ethers';
export const CHAIN=10143;
const random=()=>randomBytes(32).toString('hex');
export const hash=s=>createHash('sha256').update(s).digest('hex');
export const fail=(status,message)=>Object.assign(new Error(message),{status});
const wallet=a=>getAddress(a).toLowerCase();
export function tokenCipher(key){
  if(!/^[a-f0-9]{64}$/i.test(key||''))throw Error('AUTH_TOKEN_KEY invalid');const bytes=Buffer.from(key,'hex');if(bytes.length!==32)throw Error('AUTH_TOKEN_KEY must contain 32 bytes');
  return {seal(value,aad){const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',bytes,nonce);cipher.setAAD(Buffer.from(aad));return Buffer.concat([Buffer.from([1]),nonce,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]);},
    open(data,aad){const envelope=Buffer.from(data);if(envelope[0]!==1)throw Error('Unknown token key version');const b=envelope.subarray(1);const decipher=createDecipheriv('aes-256-gcm',bytes,b.subarray(0,12));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(b.subarray(-16));return JSON.parse(Buffer.concat([decipher.update(b.subarray(12,-16)),decipher.final()]).toString());}};
}
const aad=row=>`v1|${row.sid}|${row.uid}|${row.wallet}|${row.chain_id}`;
export class AuthService {
  constructor({db,origin,key,authFactory}){this.db=db;this.origin=new URL(origin).origin;this.cipher=tokenCipher(key);this.authFactory=authFactory;}
  async challenge(address,transaction,rateKey='global'){
    const owner=wallet(address),nonce=random(),now=new Date(),expires=new Date(now.getTime()+180000);
    for(const [name,limit] of [['global',100],[`wallet:${owner}`,5],[`client:${rateKey}`,10]]){
      const key=hash(`${name}:${Math.floor(now.getTime()/60000)}`);
      const r=await this.db.query('INSERT INTO fanpool_private.rate_limits(key,count,expires_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=fanpool_private.rate_limits.count+1 RETURNING count',[key,new Date(now.getTime()+120000)]);
      if(r.rows[0].count>limit)throw fail(429,'请求过于频繁，请稍后再试。');
    }
    const message=`${new URL(this.origin).host} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\nSign in to FanPool. This signature does not authorize funds. EOA wallets only.\n\nURI: ${this.origin}/auth\nVersion: 1\nChain ID: ${CHAIN}\nNonce: ${nonce}\nIssued At: ${now.toISOString()}\nExpiration Time: ${expires.toISOString()}\nNot Before: ${now.toISOString()}`;
    const conn=await this.db.connect();try{
      await conn.query('BEGIN');await conn.query("SET LOCAL lock_timeout='2s'");await conn.query("SET LOCAL statement_timeout='10s'");
      await conn.query('INSERT INTO fanpool_private.login_contexts(hash) VALUES($1) ON CONFLICT DO NOTHING',[hash(transaction)]);
      const context=await conn.query('SELECT generation FROM fanpool_private.login_contexts WHERE hash=$1 FOR UPDATE',[hash(transaction)]);
      await conn.query('INSERT INTO fanpool_private.challenges(nonce,transaction_hash,generation,wallet,chain_id,origin,message,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[nonce,hash(transaction),context.rows[0].generation,owner,CHAIN,this.origin,message,expires]);
      await conn.query('COMMIT');
    }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e;}finally{conn.release();}
    return {nonce,message,expiresAt:expires.toISOString()};
  }
  async verify(auth,tokens,expectedWallet){
    if(!tokens?.access_token||!tokens?.refresh_token)throw fail(401,'身份交换没有返回有效会话。');
    const [{data:u,error:ue},{data:c,error:ce}]=await Promise.all([auth.getUser(tokens.access_token),auth.getClaims(tokens.access_token)]);
    const claims=c?.claims,user=u?.user;
    if(ue||ce||!user||!claims||claims.sub!==user.id||!claims.session_id||!claims.exp||claims.exp<=Date.now()/1000)throw fail(401,'身份会话验证失败。');
    const identities=user.identities||[];
    const valid=identities.some(i=>i.provider==='web3'&&i.identity_data?.chain==='ethereum'&&typeof i.identity_data.address==='string'&&wallet(i.identity_data.address)===expectedWallet&&String(i.id).toLowerCase()===`web3:ethereum:${expectedWallet}`);
    if(!valid)throw fail(401,'已验证的钱包身份不匹配。');
    return {uid:user.id,sid:claims.session_id,wallet:expectedWallet,chain_id:CHAIN,exp:claims.exp};
  }
  async complete({nonce,message,signature},transaction){
    if(typeof nonce!=='string'||typeof message!=='string'||typeof signature!=='string'||signature.length!==132)throw fail(400,'登录格式无效，仅支持普通 EOA 签名。');
    const result=await this.db.query('SELECT * FROM fanpool_private.challenges WHERE nonce=$1',[nonce]);const c=result.rows[0];
    if(!c||c.used_at||c.cancelled_at||new Date(c.expires_at)<=new Date()||c.transaction_hash!==hash(transaction)||c.message!==message||c.origin!==this.origin||Number(c.chain_id)!==CHAIN||!message.startsWith(new URL(this.origin).host+' wants'))throw fail(401,'挑战无效、已使用或已过期，请重新登录。');
    let recovered;try{recovered=wallet(verifyMessage(message,signature));}catch{throw fail(401,'签名无效。');}if(recovered!==c.wallet)throw fail(401,'签名钱包不匹配。');
    // One SQL statement is its own committed transaction. No external call before it.
    const consumed=await this.db.query('UPDATE fanpool_private.challenges SET used_at=now() WHERE nonce=$1 AND transaction_hash=$2 AND used_at IS NULL AND cancelled_at IS NULL AND expires_at>now() RETURNING nonce',[nonce,hash(transaction)]);
    if(consumed.rowCount!==1)throw fail(409,'挑战已被消费，请重新登录。');
    const auth=this.authFactory();const {data,error}=await auth.signInWithWeb3({chain:'ethereum',message,signature});if(error)throw fail(401,'身份交换失败，请获取新的挑战。');
    const row=await this.verify(auth,data?.session,recovered),handle=random();const expires=new Date(Date.now()+86400000);
    const conn=await this.db.connect();try{
      await conn.query('BEGIN');await conn.query("SET LOCAL lock_timeout='2s'");await conn.query("SET LOCAL statement_timeout='10s'");
      const context=await conn.query('SELECT generation FROM fanpool_private.login_contexts WHERE hash=$1 FOR UPDATE',[hash(transaction)]);if(!context.rows[0]||String(context.rows[0].generation)!==String(c.generation))throw fail(401,'浏览器登录上下文已撤销。');
      const live=await conn.query('SELECT cancelled_at,expires_at FROM fanpool_private.challenges WHERE nonce=$1 FOR UPDATE',[nonce]);
      if(!live.rows[0]||live.rows[0].cancelled_at||new Date(live.rows[0].expires_at)<=new Date())throw fail(401,'登录尝试已撤销或过期。');
      await conn.query('INSERT INTO fanpool_private.sessions(sid,uid,wallet,chain_id,login_hash,handle_hash,tokens,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[row.sid,row.uid,row.wallet,CHAIN,hash(transaction),hash(handle),this.cipher.seal(data.session,aad(row)),expires]);
      await conn.query('COMMIT');
    }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e;}finally{conn.release();}
    return {handle,identity:{wallet:row.wallet,chainId:CHAIN},expires};
  }
  async session(handle,{refresh=false}={}){
    if(!/^[a-f0-9]{64}$/.test(handle||''))throw fail(401,'尚未登录。');
    const conn=await this.db.connect();let rotationStarted=false,locked=false;try{
      for(let i=0;i<40;i++){const lock=await conn.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[hash(handle)]);if(lock.rows[0].locked){locked=true;break;}await new Promise(r=>setTimeout(r,50));}if(!locked)throw fail(503,'登录刷新处理中，请稍后再试。');
      await conn.query('BEGIN');await conn.query("SET LOCAL lock_timeout='2s'");await conn.query("SET LOCAL statement_timeout='10s'");await conn.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
      const r=await conn.query('SELECT * FROM fanpool_private.sessions WHERE handle_hash=$1 FOR UPDATE',[hash(handle)]),row=r.rows[0];
      if(!row||row.revoked_at||row.refresh_pending||new Date(row.expires_at)<=new Date())throw fail(401,'登录已失效，请重新签名。');
      let tokens=this.cipher.open(row.tokens,aad(row));const auth=this.authFactory();
      // Token expiry is a scheduling hint; identity is always verified below.
      const expires=Number(tokens.expires_at||0);
      if(expires<Date.now()/1000+30){
        if(!refresh)throw fail(401,'登录需要刷新。');
        rotationStarted=true;
        // Durable intent survives a worker crash after the remote token rotated.
        await conn.query('UPDATE fanpool_private.sessions SET refresh_pending=true WHERE sid=$1',[row.sid]);await conn.query('COMMIT');
        await conn.query('BEGIN');await conn.query("SET LOCAL lock_timeout='2s'");await conn.query("SET LOCAL statement_timeout='10s'");await conn.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
        const live=await conn.query('SELECT revoked_at FROM fanpool_private.sessions WHERE sid=$1 FOR UPDATE',[row.sid]);if(live.rows[0]?.revoked_at)throw fail(401,'登录已撤销。');
        const {data,error}=await auth.refreshSession({refresh_token:tokens.refresh_token});if(error||!data?.session)throw fail(401,'登录刷新失败，请重新签名。');tokens=data.session;
      }
      const verified=await this.verify(auth,tokens,row.wallet);
      if(verified.sid!==row.sid||verified.uid!==row.uid||Number(row.chain_id)!==CHAIN)throw fail(401,'刷新会话与原授权不一致，请重新签名。');
      if(refresh)await conn.query('UPDATE fanpool_private.sessions SET tokens=$2,refresh_pending=false WHERE sid=$1 AND revoked_at IS NULL',[row.sid,this.cipher.seal(tokens,aad(row))]);
      await conn.query('COMMIT');return {wallet:row.wallet,chainId:CHAIN};
    }catch(e){await conn.query('ROLLBACK').catch(()=>{});if(rotationStarted)await this.db.query('UPDATE fanpool_private.sessions SET revoked_at=now() WHERE handle_hash=$1 AND revoked_at IS NULL',[hash(handle)]).catch(()=>{});throw e;}finally{if(locked)await conn.query('SELECT pg_advisory_unlock(hashtext($1))',[hash(handle)]).catch(()=>{});conn.release();}
  }
  async logout(handle,transaction){
    const valid=x=>/^[a-f0-9]{64}$/.test(x||'');if(!valid(handle)&&!valid(transaction))return;
    const conn=await this.db.connect();try{
      await conn.query('BEGIN');await conn.query("SET LOCAL lock_timeout='10s'");await conn.query("SET LOCAL statement_timeout='12s'");
      if(valid(transaction)){
        await conn.query('UPDATE fanpool_private.login_contexts SET generation=generation+1 WHERE hash=$1',[hash(transaction)]);
        await conn.query('UPDATE fanpool_private.challenges SET cancelled_at=now() WHERE transaction_hash=$1',[hash(transaction)]);
        await conn.query('UPDATE fanpool_private.sessions SET revoked_at=now() WHERE login_hash=$1 AND revoked_at IS NULL',[hash(transaction)]);
      }
      if(valid(handle))await conn.query('UPDATE fanpool_private.sessions SET revoked_at=now() WHERE handle_hash=$1 AND revoked_at IS NULL',[hash(handle)]);
      await conn.query('COMMIT');
    }catch(e){await conn.query('ROLLBACK').catch(()=>{});throw e;}finally{conn.release();}
  }
}
