import {getAddress} from 'ethers';
// Pool's idle-client listener does not protect a checked-out Client. PostgreSQL
// transaction_timeout closes the connection and can emit error after query rejection.
function watchClient(conn){
 let connectionError;
 const onError=error=>{connectionError ||= error;};
 conn.on('error',onError);
 return {release(failure){
  const discard=connectionError||failure;
  if(discard){
   // Keep the listener through socket teardown; never return a failed transaction's
   // connection to the pool. Its end event is the final lifecycle boundary.
   conn.once('end',()=>conn.removeListener('error',onError));
   conn.release(discard);
  }else{
   conn.release();
   conn.removeListener('error',onError);
  }
 }};
}
export class IndexStore{
 constructor(db,cfg){this.db=db;this.key=[cfg.chainId,getAddress(cfg.factory).toLowerCase()];this.start=Number(cfg.factoryDeploymentBlock);if(!Number.isSafeInteger(this.start)||this.start<0)throw Error('Factory deployment block required');}
 async acquire(){await this.db.query('INSERT INTO fanpool_index.cursors(chain_id,factory,indexed_through) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[...this.key,this.start-1]);return (await this.db.query("UPDATE fanpool_index.cursors SET fence=fence+1,lease_until=clock_timestamp()+interval '25 seconds' WHERE chain_id=$1 AND factory=$2 AND (lease_until IS NULL OR lease_until<clock_timestamp()) AND next_eligible_at<=clock_timestamp() RETURNING *",this.key)).rows[0];}
 async status(db=this.db){return (await db.query("SELECT indexed_through,block_hash,finalized_seen,next_eligible_at,last_error,updated_at,pending->'offset' AS batch_offset,jsonb_array_length(pending->'addresses') AS batch_total FROM fanpool_index.cursors WHERE chain_id=$1 AND factory=$2",this.key)).rows[0]||null;}
 async poolAddresses(){const r=await this.db.query('SELECT pool FROM fanpool_index.pools WHERE chain_id=$1 AND factory=$2 ORDER BY pool LIMIT 201',this.key);if(r.rows.length>200)throw Error('INDEX_CAPACITY');return r.rows.map(r=>r.pool);}
 async release(fence,error=null,head=null){await this.db.query("UPDATE fanpool_index.cursors SET lease_until=NULL,last_error=$4,finalized_seen=COALESCE($5,finalized_seen),next_eligible_at=clock_timestamp()+CASE WHEN $4::text IS NULL OR $4='BUDGET' THEN interval '0 seconds' ELSE interval '30 seconds' END,updated_at=clock_timestamp() WHERE chain_id=$1 AND factory=$2 AND fence=$3",[...this.key,fence,error,head]);}
 async commit(fence,from,to,blockHash,head,pools,events){const conn=await this.db.connect(),watch=watchClient(conn);let failure;try{
  await conn.query('BEGIN');await conn.query("SET LOCAL transaction_timeout='5s'");await conn.query("SET LOCAL lock_timeout='2s'");await conn.query("SET LOCAL statement_timeout='5s'");await conn.query("SET LOCAL idle_in_transaction_session_timeout='5s'");
  const row=(await conn.query('SELECT fence,indexed_through,lease_until>clock_timestamp() live FROM fanpool_index.cursors WHERE chain_id=$1 AND factory=$2 FOR UPDATE',this.key)).rows[0];
  if(!row||String(row.fence)!==String(fence)||!row.live||Number(row.indexed_through)!==from-1)throw Error('STALE_LEASE');
  await conn.query(`INSERT INTO fanpool_index.pools(chain_id,factory,pool,token,organizer,creation_tx,creation_block,creation_hash) SELECT $1::bigint,$2::text,x->>'pool',x->>'token',x->>'organizer',x->>'creationTx',(x->>'creationBlock')::bigint,x->>'creationHash' FROM jsonb_array_elements($3::jsonb) x ON CONFLICT DO NOTHING`,[...this.key,JSON.stringify(pools)]);
  await conn.query(`INSERT INTO fanpool_index.events(chain_id,factory,pool,tx_hash,log_index,block_number,block_hash,name,args) SELECT $1::bigint,$2::text,x->>'pool',x->>'hash',(x->>'index')::integer,(x->>'block')::bigint,x->>'blockHash',x->>'name',x->'args' FROM jsonb_array_elements($3::jsonb) x ON CONFLICT DO NOTHING`,[...this.key,JSON.stringify(events)]);
  await conn.query(`INSERT INTO fanpool_index.participants(chain_id,factory,pool,owner) SELECT DISTINCT $1::bigint,$2::text,x->>'pool',lower(x->'args'->>'owner') FROM jsonb_array_elements($3::jsonb) x WHERE x->>'name'='Joined' ON CONFLICT DO NOTHING`,[...this.key,JSON.stringify(events)]);
  const updated=await conn.query('UPDATE fanpool_index.cursors SET indexed_through=$4,block_hash=$5,finalized_seen=$6,last_error=NULL,pending=NULL,updated_at=clock_timestamp() WHERE chain_id=$1 AND factory=$2 AND fence=$3 AND lease_until>clock_timestamp() RETURNING fence',[...this.key,fence,to,blockHash,head]);if(updated.rowCount!==1)throw Error('STALE_LEASE');await conn.query('COMMIT');
 }catch(e){failure=e;await conn.query('ROLLBACK').catch(()=>{});throw e;}finally{watch.release(failure);}}
 async stage(fence,pending){const result=await this.db.query('UPDATE fanpool_index.cursors SET pending=$4,updated_at=clock_timestamp() WHERE chain_id=$1 AND factory=$2 AND fence=$3 AND lease_until>clock_timestamp() RETURNING fence',[...this.key,fence,pending]);if(result.rowCount!==1)throw Error('STALE_LEASE');}
 async consistent(read){const conn=await this.db.connect(),watch=watchClient(conn);let failure;try{await conn.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await conn.query("SET LOCAL statement_timeout='3s'");const value=await read(conn);await conn.query('COMMIT');return value;}catch(e){failure=e;await conn.query('ROLLBACK').catch(()=>{});throw e;}finally{watch.release(failure);}}
 async list(options={}){return this.consistent(db=>this.listAt(db,options));}
 async listAt(db,{owner,kind='all',before}={}){let filter='',values=[...this.key];if(owner){values.push(getAddress(owner).toLowerCase());filter=kind==='participation'?` AND EXISTS(SELECT 1 FROM fanpool_index.participants m WHERE m.chain_id=p.chain_id AND m.factory=p.factory AND m.pool=p.pool AND m.owner=$3)`:' AND p.organizer=$3';}if(before){const [block,pool]=before.split(':');if(!/^\d{1,15}$/.test(block))throw Error('Invalid index cursor');values.push(block,getAddress(pool).toLowerCase());filter+=` AND (p.creation_block,p.pool)<($${values.length-1}::bigint,$${values.length}::text)`;}const rows=(await db.query('SELECT p.* FROM fanpool_index.pools p WHERE p.chain_id=$1 AND p.factory=$2'+filter+' ORDER BY p.creation_block DESC,p.pool DESC LIMIT 21',values)).rows;const items=rows.slice(0,20);return {items,next:rows.length>20?`${items.at(-1).creation_block}:${items.at(-1).pool}`:null,sync:await this.status(db)};}
 async detail(address){return this.consistent(db=>this.detailAt(db,address));}
 async detailAt(db,address){const pool=getAddress(address).toLowerCase(),key=[...this.key,pool];const source=(await db.query('SELECT * FROM fanpool_index.pools WHERE chain_id=$1 AND factory=$2 AND pool=$3',key)).rows[0]||null;const members=(await db.query('SELECT owner FROM fanpool_index.participants WHERE chain_id=$1 AND factory=$2 AND pool=$3 ORDER BY owner LIMIT 51',key)).rows;const events=(await db.query('SELECT name,args,tx_hash AS hash,block_number AS block,log_index AS index FROM fanpool_index.events WHERE chain_id=$1 AND factory=$2 AND pool=$3 ORDER BY block_number DESC,log_index DESC LIMIT 201',key)).rows;return {source,owners:members.slice(0,50).map(r=>r.owner),membersComplete:members.length<=50,events:events.slice(0,200).reverse(),eventsComplete:events.length<=200,sync:await this.status(db)};}
}
