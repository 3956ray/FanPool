-- Declarative authentication schema. Apply only to an explicitly approved DB.
-- The deployment administrator creates a login inheriting this restricted role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='fanpool_auth') THEN CREATE ROLE fanpool_auth NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS fanpool_private;
REVOKE ALL ON SCHEMA fanpool_private FROM PUBLIC;
GRANT USAGE ON SCHEMA fanpool_private TO fanpool_auth;
CREATE TABLE IF NOT EXISTS fanpool_private.login_contexts (hash text PRIMARY KEY, generation bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS fanpool_private.challenges (
  nonce text PRIMARY KEY, transaction_hash text NOT NULL, generation bigint NOT NULL, wallet text NOT NULL,
  chain_id bigint NOT NULL, origin text NOT NULL, message text NOT NULL, expires_at timestamptz NOT NULL,
  used_at timestamptz, cancelled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fanpool_private.sessions (
  sid uuid PRIMARY KEY, uid uuid NOT NULL, wallet text NOT NULL, chain_id bigint NOT NULL,
  login_hash text NOT NULL, handle_hash text UNIQUE NOT NULL, tokens bytea NOT NULL, refresh_pending boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fanpool_private.rate_limits (
  key text PRIMARY KEY, count integer NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE fanpool_private.login_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanpool_private.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanpool_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fanpool_private.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA fanpool_private FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA fanpool_private TO fanpool_auth;
CREATE POLICY auth_service_contexts ON fanpool_private.login_contexts TO fanpool_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_service_challenges ON fanpool_private.challenges TO fanpool_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_service_sessions ON fanpool_private.sessions TO fanpool_auth USING (true) WITH CHECK (true);
CREATE POLICY auth_service_limits ON fanpool_private.rate_limits TO fanpool_auth USING (true) WITH CHECK (true);
-- No views, public RPCs, grants or policies for anon/authenticated are created.

CREATE INDEX sessions_login_hash ON fanpool_private.sessions(login_hash);
CREATE INDEX challenges_transaction_hash ON fanpool_private.challenges(transaction_hash);
