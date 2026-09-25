-- First publication only. Private schema is not exposed through PostgREST/GraphQL.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fanpool_metadata_reader') THEN CREATE ROLE fanpool_metadata_reader NOLOGIN; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fanpool_metadata_writer') THEN CREATE ROLE fanpool_metadata_writer NOLOGIN; END IF;
END $$;
CREATE SCHEMA fanpool_data;
REVOKE ALL ON SCHEMA fanpool_data FROM PUBLIC;
GRANT USAGE ON SCHEMA fanpool_data TO fanpool_metadata_reader,fanpool_metadata_writer;
CREATE TABLE fanpool_data.metadata (
 chain_id bigint NOT NULL, factory text NOT NULL, pool text NOT NULL,
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
 reference text NOT NULL CHECK(char_length(reference)<=2048),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(chain_id,factory,pool),
 CHECK(factory ~ '^0x[0-9a-f]{40}$' AND pool ~ '^0x[0-9a-f]{40}$')
);
ALTER TABLE fanpool_data.metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fanpool_data.metadata FROM PUBLIC;
GRANT SELECT ON fanpool_data.metadata TO fanpool_metadata_reader,fanpool_metadata_writer;
GRANT INSERT ON fanpool_data.metadata TO fanpool_metadata_writer;
CREATE POLICY metadata_read ON fanpool_data.metadata FOR SELECT TO fanpool_metadata_reader,fanpool_metadata_writer USING(true);
CREATE POLICY metadata_first_write ON fanpool_data.metadata FOR INSERT TO fanpool_metadata_writer WITH CHECK(true);
-- No UPDATE/DELETE grant, sequence, public function, or anon/authenticated policy.
