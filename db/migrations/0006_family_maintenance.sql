GRANT CREATE ON SCHEMA app_private TO iharu_policy;
-- No public or app_runtime caller may mark a relationship VERIFIED.
-- A future signed provider callback/approved reviewer calls this only with separately scoped credentials.
CREATE FUNCTION app_private.record_relationship_result(draft_key uuid,transaction_key text,subject_key text,verified_birth date,evidence_key text,approved boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d app_private.child_registration_drafts%ROWTYPE;
BEGIN
 SELECT * INTO d FROM app_private.child_registration_drafts WHERE id=draft_key FOR UPDATE;
 IF NOT FOUND OR d.expires_at<=now() OR d.state NOT IN ('DRAFT','PENDING','VERIFIED','REJECTED') THEN RAISE EXCEPTION 'INVALID_VERIFICATION'; END IF;
 IF d.verification_id IS NOT NULL THEN
  IF d.verification_id=transaction_key AND d.subject_ref=subject_key AND d.birth_date=verified_birth AND d.evidence_ref=evidence_key AND d.state=(CASE WHEN approved THEN 'VERIFIED' ELSE 'REJECTED' END) THEN RETURN; END IF;
  RAISE EXCEPTION 'VERIFICATION_REUSED';
 END IF;
 IF transaction_key IS NULL OR length(transaction_key) NOT BETWEEN 1 AND 200 OR subject_key IS NULL OR length(subject_key) NOT BETWEEN 1 AND 200 OR verified_birth IS NULL OR verified_birth>current_date OR evidence_key IS NULL OR length(evidence_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'INVALID_VERIFICATION'; END IF;
 UPDATE app_private.child_registration_drafts SET state=CASE WHEN approved THEN 'VERIFIED' ELSE 'REJECTED' END,subject_ref=subject_key,birth_date=verified_birth,evidence_ref=evidence_key,verification_id=transaction_key WHERE id=draft_key;
END $$;
-- Scope-only metadata supports exact replay of a grant revocation; it never includes names, DOB, message bodies or coordinates.
ALTER TABLE app_private.security_events ADD COLUMN scope jsonb NOT NULL DEFAULT '{}';
CREATE FUNCTION app_private.capture_revocation_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE eid uuid;
BEGIN
 IF (OLD.daily AND NOT NEW.daily) OR (OLD.chat AND NOT NEW.chat) OR (OLD.location AND NOT NEW.location) OR (OLD.tuition_read AND NOT NEW.tuition_read) OR (OLD.tuition_write AND NOT NEW.tuition_write) THEN
  INSERT INTO app_private.security_events(target_id,kind,scope) VALUES(NEW.child_id,'CHILD_GRANT_REVOKED',jsonb_build_object('memberId',NEW.member_id,'daily',OLD.daily AND NOT NEW.daily,'chat',OLD.chat AND NOT NEW.chat,'location',OLD.location AND NOT NEW.location,'tuitionRead',OLD.tuition_read AND NOT NEW.tuition_read,'tuitionWrite',OLD.tuition_write AND NOT NEW.tuition_write)) RETURNING id INTO eid;
  INSERT INTO app_private.outbox(event_id,kind) VALUES(eid,'INDEPENDENT_JOURNAL');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER grant_revocation AFTER UPDATE ON app.child_grants FOR EACH ROW EXECUTE FUNCTION app_private.capture_revocation_scope();
-- One narrow maintenance call, not broad worker table privileges. P11/P12 connects the worker and external journal.
CREATE FUNCTION app_private.expire_family_secrets() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 UPDATE app_private.device_pairings SET sealed_response=NULL WHERE retry_until<=now() AND sealed_response IS NOT NULL;
 UPDATE app_private.device_pairings SET state='REVOKED',sealed_response=NULL WHERE expires_at<=now() AND state IN ('WAITING','APPROVED');
 DELETE FROM app_private.device_pairings WHERE expires_at<now()-interval '1 day';
 DELETE FROM app_private.consent_proofs WHERE expires_at<now() OR draft_id IN (SELECT id FROM app_private.child_registration_drafts WHERE expires_at<now());
 DELETE FROM app_private.child_registration_drafts WHERE expires_at<now() AND state<>'ACTIVATED';
 -- Activated evidence is retained in child_consents. Redundant enrollment PII is cleared.
 UPDATE app_private.child_registration_drafts SET birth_date=NULL,subject_ref=NULL,evidence_ref=NULL WHERE state='ACTIVATED' AND expires_at<now();
 DELETE FROM app_private.invites WHERE expires_at<now()-interval '1 day';
END $$;
ALTER FUNCTION app_private.record_relationship_result(uuid,text,text,date,text,boolean) OWNER TO iharu_policy;
ALTER FUNCTION app_private.capture_revocation_scope() OWNER TO iharu_policy;
ALTER FUNCTION app_private.expire_family_secrets() OWNER TO iharu_policy;
REVOKE ALL ON FUNCTION app_private.record_relationship_result(uuid,text,text,date,text,boolean),app_private.capture_revocation_scope(),app_private.expire_family_secrets() FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='verification_runtime') THEN
  GRANT USAGE ON SCHEMA app_private TO verification_runtime;
  GRANT EXECUTE ON FUNCTION app_private.record_relationship_result(uuid,text,text,date,text,boolean) TO verification_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_runtime') THEN
  GRANT USAGE ON SCHEMA app_private TO worker_runtime;
  GRANT EXECUTE ON FUNCTION app_private.expire_family_secrets() TO worker_runtime;
 END IF;
END $$;

REVOKE CREATE ON SCHEMA app_private FROM iharu_policy;
