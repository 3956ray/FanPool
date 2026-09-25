-- Rebuildable chain index; never a funds authority. Apply only after Gate.
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='fanpool_index_reader') THEN CREATE ROLE fanpool_index_reader NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='fanpool_index_worker') THEN CREATE ROLE fanpool_index_worker NOLOGIN; END IF;
END $$;
CREATE SCHEMA fanpool_index;
REVOKE ALL ON SCHEMA fanpool_index FROM PUBLIC;
GRANT USAGE ON SCHEMA fanpool_index TO fanpool_index_reader,fanpool_index_worker;
CREATE TABLE fanpool_index.cursors(
 chain_id bigint NOT NULL,factory text NOT NULL, indexed_through bigint NOT NULL, block_hash text,
 finalized_seen bigint, pending jsonb, fence bigint NOT NULL DEFAULT 0, lease_until timestamptz,
 next_eligible_at timestamptz NOT NULL DEFAULT now(), last_error text, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(chain_id,factory)
);
CREATE TABLE fanpool_index.pools(
 chain_id bigint NOT NULL,factory text NOT NULL,pool text NOT NULL,token text NOT NULL,organizer text NOT NULL,
 creation_tx text NOT NULL,creation_block bigint NOT NULL,creation_hash text NOT NULL,
 PRIMARY KEY(chain_id,factory,pool)
);
CREATE INDEX pools_listing ON fanpool_index.pools(chain_id,factory,creation_block DESC,pool DESC);
CREATE INDEX pools_organizer ON fanpool_index.pools(chain_id,factory,organizer,creation_block DESC,pool DESC);
CREATE TABLE fanpool_index.events(
 chain_id bigint NOT NULL,factory text NOT NULL,pool text NOT NULL,tx_hash text NOT NULL,log_index integer NOT NULL,
 block_number bigint NOT NULL,block_hash text NOT NULL,name text NOT NULL,args jsonb NOT NULL,
 PRIMARY KEY(chain_id,factory,tx_hash,log_index)
);
CREATE INDEX events_pool ON fanpool_index.events(chain_id,factory,pool,block_number DESC,log_index DESC);
CREATE TABLE fanpool_index.participants(
 chain_id bigint NOT NULL,factory text NOT NULL,pool text NOT NULL,owner text NOT NULL,
 PRIMARY KEY(chain_id,factory,pool,owner)
);
CREATE INDEX participation_owner ON fanpool_index.participants(chain_id,factory,owner,pool);
REVOKE ALL ON ALL TABLES IN SCHEMA fanpool_index FROM PUBLIC;
GRANT SELECT ON ALL TABLES IN SCHEMA fanpool_index TO fanpool_index_reader,fanpool_index_worker;
GRANT INSERT ON ALL TABLES IN SCHEMA fanpool_index TO fanpool_index_worker;
GRANT UPDATE ON fanpool_index.cursors TO fanpool_index_worker;
ALTER TABLE fanpool_index.cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanpool_index.pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanpool_index.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanpool_index.participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY cursor_read ON fanpool_index.cursors FOR SELECT TO fanpool_index_reader,fanpool_index_worker USING(true);
CREATE POLICY cursor_insert ON fanpool_index.cursors FOR INSERT TO fanpool_index_worker WITH CHECK(true);
CREATE POLICY cursor_update ON fanpool_index.cursors FOR UPDATE TO fanpool_index_worker USING(true) WITH CHECK(true);
CREATE POLICY pool_read ON fanpool_index.pools FOR SELECT TO fanpool_index_reader,fanpool_index_worker USING(true);
CREATE POLICY pool_insert ON fanpool_index.pools FOR INSERT TO fanpool_index_worker WITH CHECK(true);
CREATE POLICY event_read ON fanpool_index.events FOR SELECT TO fanpool_index_reader,fanpool_index_worker USING(true);
CREATE POLICY event_insert ON fanpool_index.events FOR INSERT TO fanpool_index_worker WITH CHECK(true);
CREATE POLICY participant_read ON fanpool_index.participants FOR SELECT TO fanpool_index_reader,fanpool_index_worker USING(true);
CREATE POLICY participant_insert ON fanpool_index.participants FOR INSERT TO fanpool_index_worker WITH CHECK(true);
