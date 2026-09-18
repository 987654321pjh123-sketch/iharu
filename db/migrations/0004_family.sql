-- P03. Migrate with a dedicated DDL account; never use that account in API runtime.
-- No login credentials are provisioned here. iharu_policy is a NOLOGIN function owner.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iharu_policy') THEN
    CREATE ROLE iharu_policy NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='iharu_policy' AND (rolcanlogin OR rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'UNSAFE_POLICY_ROLE';
  END IF;
END $$;
CREATE TABLE app.families (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 40),
 owner_id uuid NOT NULL REFERENCES iharu_auth.members(id), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','CLOSED')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES app.families(id),
 member_id uuid NOT NULL REFERENCES iharu_auth.members(id), status text NOT NULL CHECK(status IN ('PENDING','ACTIVE','REVOKED')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(family_id,member_id), UNIQUE(family_id,id)
);
CREATE TABLE app.children (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES app.families(id),
 nickname text NOT NULL CHECK(length(nickname) BETWEEN 1 AND 24), birth_date date NOT NULL,
 consenter_id uuid NOT NULL REFERENCES iharu_auth.members(id), status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')),
 consent_epoch integer NOT NULL DEFAULT 1, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(family_id,id)
);
CREATE TABLE app.child_consents (
 family_id uuid NOT NULL, child_id uuid NOT NULL, purpose text NOT NULL CHECK(purpose IN ('general','location')),
 consenter_id uuid NOT NULL REFERENCES iharu_auth.members(id), policy_version text NOT NULL, evidence_ref text NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, PRIMARY KEY(child_id,purpose),
 FOREIGN KEY(family_id,child_id) REFERENCES app.children(family_id,id)
);
CREATE TABLE app.child_grants (
 family_id uuid NOT NULL, child_id uuid NOT NULL, member_id uuid NOT NULL,
 daily boolean NOT NULL DEFAULT false, chat boolean NOT NULL DEFAULT false, location boolean NOT NULL DEFAULT false,
 tuition_read boolean NOT NULL DEFAULT false, tuition_write boolean NOT NULL DEFAULT false CHECK(NOT tuition_write OR tuition_read),
 approved_by uuid NOT NULL REFERENCES iharu_auth.members(id), starts_at timestamptz NOT NULL DEFAULT now(), starts_seq bigint NOT NULL DEFAULT 1,
 version integer NOT NULL DEFAULT 1, PRIMARY KEY(child_id,member_id),
 FOREIGN KEY(family_id,child_id) REFERENCES app.children(family_id,id), FOREIGN KEY(family_id,member_id) REFERENCES app.memberships(family_id,member_id)
);
CREATE TABLE app.rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL, child_id uuid NOT NULL UNIQUE,
 last_seq bigint NOT NULL DEFAULT 0, epoch integer NOT NULL DEFAULT 1, FOREIGN KEY(family_id,child_id) REFERENCES app.children(family_id,id)
);
CREATE TABLE app.child_devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL, child_id uuid NOT NULL,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 40), token_hash text UNIQUE NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','REVOKED')), session_epoch integer NOT NULL DEFAULT 1,
 last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 FOREIGN KEY(family_id,child_id) REFERENCES app.children(family_id,id)
);
CREATE TABLE app_private.invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES app.families(id), token_hash text UNIQUE NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', accepted_by uuid REFERENCES iharu_auth.members(id), revoked_at timestamptz
);
CREATE TABLE app_private.child_registration_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL REFERENCES app.families(id), applicant_id uuid NOT NULL REFERENCES iharu_auth.members(id),
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','PENDING','VERIFIED','REJECTED','ACTIVATED')),
 subject_ref text, birth_date date, evidence_ref text, verification_id text UNIQUE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', child_id uuid REFERENCES app.children(id)
);
CREATE TABLE app_private.consent_proofs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL REFERENCES app_private.child_registration_drafts(id),
 applicant_id uuid NOT NULL REFERENCES iharu_auth.members(id), family_id uuid NOT NULL REFERENCES app.families(id),
 subject_ref text NOT NULL, birth_date date NOT NULL, policy_version text NOT NULL CHECK(policy_version='6.1'),
 location boolean NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', consumed_at timestamptz
);
CREATE TABLE app_private.device_pairings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code_hash text NOT NULL, proof_hash text UNIQUE NOT NULL, label text NOT NULL CHECK(length(label) BETWEEN 1 AND 40),
 state text NOT NULL DEFAULT 'WAITING' CHECK(state IN ('WAITING','APPROVED','EXCHANGED','REVOKED')),
 family_id uuid, child_id uuid, approved_by uuid REFERENCES iharu_auth.members(id), version integer NOT NULL DEFAULT 1,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes', device_id uuid REFERENCES app.child_devices(id),
 exchange_key uuid, sealed_response text, retry_until timestamptz,
 FOREIGN KEY(family_id,child_id) REFERENCES app.children(family_id,id)
);
CREATE UNIQUE INDEX pairing_active_code ON app_private.device_pairings(code_hash) WHERE state IN ('WAITING','APPROVED');
CREATE TABLE app_private.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid, action text NOT NULL, target_id uuid, request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.security_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 target_id uuid NOT NULL, kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), journaled_at timestamptz
);
CREATE TABLE app_private.outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES app_private.security_events(id),
 kind text NOT NULL CHECK(kind IN ('INDEPENDENT_JOURNAL','DELETE_CHILD')), state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','LEASED','DONE','FAILED')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, UNIQUE(event_id,kind)
);
CREATE TABLE app_private.deletion_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), child_id uuid NOT NULL UNIQUE REFERENCES app.children(id),
 state text NOT NULL DEFAULT 'REVOKED' CHECK(state IN ('REVOKED','PURGING','COMPLETED')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memberships_member ON app.memberships(member_id,status);
CREATE INDEX child_grants_member ON app.child_grants(member_id,child_id);
CREATE INDEX devices_child ON app.child_devices(child_id,status);
CREATE INDEX outbox_due ON app_private.outbox(state,available_at);
GRANT USAGE ON SCHEMA app,app_private,iharu_auth TO iharu_policy;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA app TO iharu_policy;
GRANT SELECT,INSERT,UPDATE,DELETE ON app_private.invites,app_private.child_registration_drafts,app_private.consent_proofs,app_private.device_pairings,app_private.audit_events,app_private.security_events,app_private.outbox,app_private.deletion_requests TO iharu_policy;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA app_private TO iharu_policy;
GRANT SELECT ON iharu_auth.members,iharu_auth.session,iharu_auth.session_guard,iharu_auth."user" TO iharu_policy;
GRANT CREATE ON SCHEMA app_private TO iharu_policy;
-- Helpers use fixed paths and explicit caller context, never a client-supplied role.
CREATE FUNCTION app_private.actor() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('iharu.member_id',true),'')::uuid
$$;
CREATE FUNCTION app_private.guardian_ready() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM iharu_auth.members m JOIN iharu_auth."user" u ON u.id=m.auth_user_id
 JOIN iharu_auth.session s ON s."userId"=u.id JOIN iharu_auth.session_guard g ON g.session_id=s.id
 WHERE m.id=app_private.actor() AND m.status='ACTIVE' AND m.access_ready AND u."emailVerified"
 AND u.email NOT LIKE '%@identity.iharu.invalid' AND s.id=current_setting('iharu.session_id',true)
 AND g.assurance='HIGH' AND s."expiresAt">now() AND g.absolute_expires_at>now() AND g.last_seen_at>now()-interval '7 days')
$$;
CREATE FUNCTION app_private.member_of(fid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT app_private.guardian_ready() AND EXISTS(SELECT 1 FROM app.memberships m JOIN app.families f ON f.id=m.family_id
 WHERE m.family_id=fid AND m.member_id=app_private.actor() AND m.status='ACTIVE' AND f.status='ACTIVE')
$$;
CREATE FUNCTION app_private.child_allowed(cid uuid,scope text DEFAULT 'any') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM app.children c JOIN app.families f ON f.id=c.family_id AND f.status='ACTIVE' JOIN app.child_consents co ON co.child_id=c.id AND co.purpose='general' AND co.revoked_at IS NULL
 WHERE c.id=cid AND c.status='ACTIVE' AND (
 (app_private.member_of(c.family_id) AND EXISTS(SELECT 1 FROM app.child_grants g WHERE g.child_id=c.id AND g.member_id=app_private.actor() AND
 CASE scope WHEN 'manage' THEN c.consenter_id=app_private.actor() WHEN 'daily' THEN g.daily WHEN 'chat' THEN g.chat
 WHEN 'location' THEN g.location AND EXISTS(SELECT 1 FROM app.child_consents lc WHERE lc.child_id=c.id AND lc.purpose='location' AND lc.revoked_at IS NULL)
 WHEN 'tuition_read' THEN g.tuition_read WHEN 'tuition_write' THEN g.tuition_read AND g.tuition_write
 ELSE g.daily OR g.chat OR g.location OR g.tuition_read END))
 OR (scope IN ('any','daily','chat','location') AND EXISTS(SELECT 1 FROM app.child_devices d WHERE d.child_id=c.id AND d.token_hash=nullif(current_setting('iharu.device_hash',true),'')
 AND d.status='ACTIVE' AND d.expires_at>now() AND d.last_seen_at>now()-interval '7 days'
 AND (scope<>'location' OR EXISTS(SELECT 1 FROM app.child_consents lc WHERE lc.child_id=c.id AND lc.purpose='location' AND lc.revoked_at IS NULL))))))
$$;
-- All business tables enforce RLS. Only the non-login policy function owner has broad access.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['families','memberships','children','child_consents','child_grants','rooms','child_devices'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tab);
 EXECUTE format('CREATE POLICY policy_executor ON app.%I TO iharu_policy USING (true) WITH CHECK (true)',tab);
 END LOOP;
END $$;
CREATE POLICY family_read ON app.families FOR SELECT TO app_runtime USING(app_private.member_of(id));
CREATE POLICY membership_read ON app.memberships FOR SELECT TO app_runtime USING(app_private.member_of(family_id));
CREATE POLICY child_read ON app.children FOR SELECT TO app_runtime USING(app_private.child_allowed(id));
CREATE POLICY consent_read ON app.child_consents FOR SELECT TO app_runtime USING(app_private.child_allowed(child_id,'manage'));
CREATE POLICY grant_read ON app.child_grants FOR SELECT TO app_runtime USING(app_private.child_allowed(child_id,'manage'));
CREATE POLICY room_read ON app.rooms FOR SELECT TO app_runtime USING(app_private.child_allowed(child_id,'chat'));
CREATE POLICY device_read ON app.child_devices FOR SELECT TO app_runtime USING(app_private.child_allowed(child_id,'manage'));
-- The policy role's policies are permissive; helpers called under it never recurse into their own predicates.
ALTER FUNCTION app_private.guardian_ready() OWNER TO iharu_policy;
ALTER FUNCTION app_private.member_of(uuid) OWNER TO iharu_policy;
ALTER FUNCTION app_private.child_allowed(uuid,text) OWNER TO iharu_policy;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.actor() TO iharu_policy;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_runtime') THEN
  GRANT USAGE ON SCHEMA app,app_private TO app_runtime;
  GRANT SELECT ON app.families,app.children,app.rooms TO app_runtime;
  GRANT EXECUTE ON FUNCTION app_private.actor(),app_private.member_of(uuid),app_private.child_allowed(uuid,text) TO app_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON SCHEMA app,app_private FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON SCHEMA app,app_private FROM authenticated; END IF;
END $$;

REVOKE CREATE ON SCHEMA app_private FROM iharu_policy;
