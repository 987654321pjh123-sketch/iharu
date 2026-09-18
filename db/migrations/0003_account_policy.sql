-- Own policy records; Better Auth tables are generated in 0002.
REVOKE ALL ON SCHEMA iharu_auth FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA iharu_auth FROM PUBLIC;

CREATE TABLE iharu_auth.members (
  id uuid PRIMARY KEY,
  auth_user_id text UNIQUE NOT NULL REFERENCES iharu_auth."user"(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETION_PENDING')),
  access_ready boolean NOT NULL DEFAULT false,
  session_epoch integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE iharu_auth.session_guard (
  session_id text PRIMARY KEY REFERENCES iharu_auth.session(id) ON DELETE CASCADE,
  assurance text NOT NULL CHECK (assurance IN ('LOW','HIGH')),
  reauthenticated_at timestamptz,
  last_seen_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL
);
CREATE TABLE iharu_auth.rate_buckets (
  key text PRIMARY KEY, count integer NOT NULL CHECK (count >= 0),
  window_start timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX rate_buckets_expiry ON iharu_auth.rate_buckets (expires_at);
CREATE TABLE iharu_auth.phone_challenges (
  key text PRIMARY KEY, code_hash text NOT NULL,
  attempts integer NOT NULL CHECK (attempts BETWEEN 0 AND 5), expires_at timestamptz NOT NULL
);
CREATE TABLE iharu_auth.recovery_cases (
  id uuid PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES iharu_auth.members(id),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE iharu_auth.email_links (
  token_hash text PRIMARY KEY,
  session_id text NOT NULL REFERENCES iharu_auth.session(id) ON DELETE CASCADE,
  user_id text UNIQUE NOT NULL REFERENCES iharu_auth."user"(id) ON DELETE CASCADE,
  email text NOT NULL,
  password_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX one_open_recovery ON iharu_auth.recovery_cases(member_id) WHERE state='OPEN';
-- A provider identity belongs to exactly one local account even under concurrent callbacks.
CREATE UNIQUE INDEX account_provider_identity ON iharu_auth.account ("providerId","accountId");
-- Grant to an existing non-owner auth_runtime role only; do not provision credentials in migrations.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='auth_runtime') THEN
    GRANT USAGE ON SCHEMA iharu_auth TO auth_runtime;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA iharu_auth TO auth_runtime;
  END IF;
END $$;
