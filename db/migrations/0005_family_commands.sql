GRANT CREATE ON SCHEMA app_private TO iharu_policy;
CREATE FUNCTION app_private.record_event(kind text,target uuid,security boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE eid uuid;
BEGIN
 INSERT INTO app_private.audit_events(actor_id,action,target_id,request_id)
 VALUES(app_private.actor(),kind,target,coalesce(nullif(current_setting('iharu.request_id',true),'')::uuid,gen_random_uuid()));
 IF security THEN
  INSERT INTO app_private.security_events(target_id,kind) VALUES(target,kind) RETURNING id INTO eid;
  INSERT INTO app_private.outbox(event_id,kind) VALUES(eid,'INDEPENDENT_JOURNAL');
  IF kind='GENERAL_CONSENT_REVOKED' THEN INSERT INTO app_private.outbox(event_id,kind) VALUES(eid,'DELETE_CHILD'); END IF;
 END IF;
END $$;
-- Narrow command entry point. Runtime cannot write policy tables or create a verification result.
CREATE FUNCTION app_private.family_command(op text,p jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app_private.actor(); fid uuid; cid uuid; target uuid; result jsonb; now_at timestamptz:=now();
 f app.families%ROWTYPE; m app.memberships%ROWTYPE; ch app.children%ROWTYPE; g app.child_grants%ROWTYPE;
 inv app_private.invites%ROWTYPE; draft app_private.child_registration_drafts%ROWTYPE; proof app_private.consent_proofs%ROWTYPE;
 pairing app_private.device_pairings%ROWTYPE; device app.child_devices%ROWTYPE;
BEGIN
 -- Device endpoints authenticate the proof cookie separately. All other commands require a current HIGH session.
 IF op NOT IN ('pair.start','pair.status','pair.exchange','child.session','child.logout') AND NOT app_private.guardian_ready() THEN RAISE EXCEPTION 'ACCESS_NOT_READY'; END IF;
 IF op='me' THEN
  SELECT jsonb_build_object('families',coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'owner',x.owner_id=actor,'version',x.version) ORDER BY x.created_at),'[]')) INTO result
  FROM app.families x JOIN app.memberships mm ON mm.family_id=x.id AND mm.member_id=actor AND mm.status='ACTIVE' WHERE x.status='ACTIVE';
  RETURN result;
 ELSIF op='family.create' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,41));
  IF (SELECT count(*) FROM app.memberships WHERE member_id=actor AND status='ACTIVE')>=5 THEN RAISE EXCEPTION 'FAMILY_LIMIT'; END IF;
  INSERT INTO app.families(name,owner_id) VALUES(p->>'name',actor) RETURNING * INTO f;
  INSERT INTO app.memberships(family_id,member_id,status) VALUES(f.id,actor,'ACTIVE');
  PERFORM app_private.record_event('FAMILY_CREATED',f.id); RETURN jsonb_build_object('id',f.id,'version',f.version);
 ELSIF op IN ('family.members','invite.create','owner.transfer','draft.create') THEN
  fid:=(p->>'familyId')::uuid;
  SELECT * INTO f FROM app.families WHERE id=fid AND status='ACTIVE' FOR UPDATE;
  IF NOT FOUND OR NOT app_private.member_of(fid) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF op='family.members' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',mm.id,'memberId',mm.member_id,'name',u.name,'status',mm.status,'owner',f.owner_id=mm.member_id,'version',mm.version) ORDER BY mm.created_at),'[]') INTO result
   FROM app.memberships mm JOIN iharu_auth.members ma ON ma.id=mm.member_id JOIN iharu_auth."user" u ON u.id=ma.auth_user_id
   WHERE mm.family_id=fid AND mm.status<>'REVOKED' AND (mm.status='ACTIVE' OR f.owner_id=actor OR mm.member_id=actor);
   RETURN jsonb_build_object('members',result);
  ELSIF op='draft.create' THEN
   SELECT * INTO draft FROM app_private.child_registration_drafts WHERE family_id=fid AND applicant_id=actor AND state IN ('DRAFT','PENDING','VERIFIED') AND expires_at>now_at ORDER BY expires_at DESC LIMIT 1;
   IF FOUND THEN RETURN jsonb_build_object('id',draft.id,'state',draft.state,'expiresAt',draft.expires_at); END IF;
   IF (SELECT count(*) FROM app.children WHERE family_id=fid AND status='ACTIVE')>=5 THEN RAISE EXCEPTION 'CHILD_LIMIT'; END IF;
   IF (SELECT count(*) FROM app_private.child_registration_drafts WHERE applicant_id=actor AND state<>'ACTIVATED' AND expires_at>now_at)>=10 THEN RAISE EXCEPTION 'DRAFT_LIMIT'; END IF;
   INSERT INTO app_private.child_registration_drafts(family_id,applicant_id) VALUES(fid,actor) RETURNING * INTO draft;
   RETURN jsonb_build_object('id',draft.id,'state',draft.state,'expiresAt',draft.expires_at);
  END IF;
  IF f.owner_id<>actor THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF op='invite.create' THEN
   IF (SELECT count(*) FROM app.memberships WHERE family_id=fid AND status='ACTIVE')>=5 THEN RAISE EXCEPTION 'ADULT_LIMIT'; END IF;
   UPDATE app_private.invites SET revoked_at=now_at WHERE family_id=fid AND accepted_by IS NULL AND revoked_at IS NULL;
   INSERT INTO app_private.invites(family_id,token_hash) VALUES(fid,p->>'tokenHash') RETURNING * INTO inv;
   RETURN jsonb_build_object('id',inv.id,'expiresAt',inv.expires_at);
  END IF;
  IF f.version<>(p->>'expectedVersion')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  target:=(p->>'memberId')::uuid;
  IF target=actor OR NOT EXISTS(SELECT 1 FROM app.memberships WHERE family_id=fid AND member_id=target AND status='ACTIVE') THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  UPDATE app.families SET owner_id=target,version=version+1 WHERE id=fid;
  PERFORM app_private.record_event('OWNER_TRANSFERRED',fid,true); RETURN jsonb_build_object('version',f.version+1);
 ELSIF op='invite.accept' THEN
  SELECT * INTO inv FROM app_private.invites WHERE token_hash=p->>'tokenHash' FOR UPDATE;
  IF NOT FOUND OR inv.expires_at<=now_at OR inv.revoked_at IS NOT NULL OR (inv.accepted_by IS NOT NULL AND inv.accepted_by<>actor) THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  SELECT * INTO f FROM app.families WHERE id=inv.family_id AND status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM app.memberships WHERE family_id=f.id AND member_id=actor AND status='ACTIVE') THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;
  IF (SELECT count(*) FROM app.memberships WHERE family_id=f.id AND status IN ('ACTIVE','PENDING'))>=10 AND inv.accepted_by IS NULL THEN RAISE EXCEPTION 'ADULT_LIMIT'; END IF;
  UPDATE app_private.invites SET accepted_by=actor WHERE id=inv.id;
  INSERT INTO app.memberships(family_id,member_id,status) VALUES(f.id,actor,'PENDING')
  ON CONFLICT(family_id,member_id) DO UPDATE SET status='PENDING' WHERE app.memberships.status='REVOKED' RETURNING * INTO m;
  IF m.id IS NULL THEN SELECT * INTO m FROM app.memberships WHERE family_id=f.id AND member_id=actor; END IF;
  RETURN jsonb_build_object('status','PENDING','membershipId',m.id);
 ELSIF op IN ('member.approve','member.revoke') THEN
  SELECT * INTO m FROM app.memberships WHERE id=(p->>'membershipId')::uuid;
  SELECT * INTO f FROM app.families WHERE id=m.family_id FOR UPDATE;
  IF f.id IS NULL OR f.owner_id<>actor OR NOT app_private.member_of(f.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO m FROM app.memberships WHERE id=m.id FOR UPDATE;
  IF m.version<>(p->>'expectedVersion')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF op='member.approve' THEN
   IF m.status<>'PENDING' THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;
   IF (SELECT count(*) FROM app.memberships WHERE family_id=f.id AND status='ACTIVE')>=5 THEN RAISE EXCEPTION 'ADULT_LIMIT'; END IF;
   UPDATE app.memberships SET status='ACTIVE',version=version+1 WHERE id=m.id;
  ELSE
   IF m.member_id=f.owner_id THEN RAISE EXCEPTION 'OWNER_REQUIRED'; END IF;
   IF EXISTS(SELECT 1 FROM app.children WHERE family_id=f.id AND consenter_id=m.member_id AND status='ACTIVE') THEN RAISE EXCEPTION 'CONSENTER_REQUIRED'; END IF;
   UPDATE app.memberships SET status='REVOKED',version=version+1 WHERE id=m.id;
   UPDATE app_private.invites SET revoked_at=now_at WHERE family_id=f.id AND accepted_by=m.member_id;
   UPDATE app.child_grants SET daily=false,chat=false,location=false,tuition_read=false,tuition_write=false,version=version+1 WHERE family_id=f.id AND member_id=m.member_id;
   UPDATE app.rooms SET epoch=epoch+1 WHERE family_id=f.id;
  END IF;
  PERFORM app_private.record_event(op,m.id,op='member.revoke'); RETURN jsonb_build_object('version',m.version+1);
 ELSIF op IN ('draft.get','consent.proof','child.activate') THEN
  SELECT * INTO draft FROM app_private.child_registration_drafts WHERE id=(p->>'draftId')::uuid AND applicant_id=actor FOR UPDATE;
  IF NOT FOUND OR draft.expires_at<=now_at OR NOT app_private.member_of(draft.family_id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF op='draft.get' THEN RETURN jsonb_build_object('id',draft.id,'state',draft.state,'expiresAt',draft.expires_at,'birthDate',CASE WHEN draft.state='VERIFIED' THEN draft.birth_date END); END IF;
  IF draft.state<>'VERIFIED' OR draft.subject_ref IS NULL OR draft.evidence_ref IS NULL OR draft.birth_date IS NULL THEN RAISE EXCEPTION 'VERIFICATION_REQUIRED'; END IF;
  IF op='consent.proof' THEN
   IF p->>'policyVersion'<>'6.1' OR (p->>'general')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'CONSENT_REQUIRED'; END IF;
   UPDATE app_private.consent_proofs SET consumed_at=now_at WHERE draft_id=draft.id AND consumed_at IS NULL;
   INSERT INTO app_private.consent_proofs(draft_id,applicant_id,family_id,subject_ref,birth_date,policy_version,location)
   VALUES(draft.id,actor,draft.family_id,draft.subject_ref,draft.birth_date,'6.1',(p->>'location')::boolean) RETURNING * INTO proof;
   RETURN jsonb_build_object('proofId',proof.id,'expiresAt',proof.expires_at);
  END IF;
  SELECT * INTO f FROM app.families WHERE id=draft.family_id FOR UPDATE;
  IF f.id<>(p->>'familyId')::uuid THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO proof FROM app_private.consent_proofs WHERE id=(p->>'proofId')::uuid AND draft_id=draft.id AND applicant_id=actor FOR UPDATE;
  IF NOT FOUND OR proof.consumed_at IS NOT NULL OR proof.expires_at<=now_at OR proof.subject_ref<>draft.subject_ref OR proof.birth_date<>(p->>'birthDate')::date OR proof.family_id<>f.id THEN RAISE EXCEPTION 'PROOF_INVALID'; END IF;
  IF (SELECT count(*) FROM app.children WHERE family_id=f.id AND status='ACTIVE')>=5 THEN RAISE EXCEPTION 'CHILD_LIMIT'; END IF;
  INSERT INTO app.children(family_id,nickname,birth_date,consenter_id) VALUES(f.id,p->>'nickname',proof.birth_date,actor) RETURNING * INTO ch;
  INSERT INTO app.child_consents(family_id,child_id,purpose,consenter_id,policy_version,evidence_ref) VALUES(f.id,ch.id,'general',actor,'6.1',draft.evidence_ref);
  IF proof.location THEN INSERT INTO app.child_consents(family_id,child_id,purpose,consenter_id,policy_version,evidence_ref) VALUES(f.id,ch.id,'location',actor,'6.1',draft.evidence_ref); END IF;
  INSERT INTO app.child_grants(family_id,child_id,member_id,daily,chat,location,tuition_read,tuition_write,approved_by) VALUES(f.id,ch.id,actor,true,true,proof.location,true,true,actor);
  INSERT INTO app.rooms(family_id,child_id) VALUES(f.id,ch.id);
  UPDATE app_private.consent_proofs SET consumed_at=now_at WHERE id=proof.id;
  UPDATE app_private.child_registration_drafts SET state='ACTIVATED',child_id=ch.id WHERE id=draft.id;
  PERFORM app_private.record_event('CHILD_ACTIVATED',ch.id); RETURN jsonb_build_object('id',ch.id,'version',ch.version);
 ELSIF op='children.list' THEN
  fid:=(p->>'familyId')::uuid;
  IF NOT app_private.member_of(fid) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'nickname',c.nickname,'version',c.version,'canManage',c.consenter_id=actor,'locationConsent',EXISTS(SELECT 1 FROM app.child_consents co WHERE co.child_id=c.id AND co.purpose='location' AND co.revoked_at IS NULL)) ORDER BY c.created_at),'[]') INTO result FROM app.children c WHERE c.family_id=fid AND app_private.child_allowed(c.id);
  RETURN jsonb_build_object('children',result);
 ELSIF op IN ('grants.get','grants.put','devices.list','device.revoke','consents.get','consent.revoke') THEN
  cid:=(p->>'childId')::uuid;
  SELECT * INTO ch FROM app.children WHERE id=cid FOR UPDATE;
  IF NOT FOUND OR NOT app_private.child_allowed(cid,'manage') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF op='grants.get' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('memberId',mm.member_id,'name',u.name,'consenter',mm.member_id=ch.consenter_id,'daily',coalesce(cg.daily,false),'chat',coalesce(cg.chat,false),'location',coalesce(cg.location,false),'tuitionRead',coalesce(cg.tuition_read,false),'tuitionWrite',coalesce(cg.tuition_write,false),'version',coalesce(cg.version,0))),'[]') INTO result
   FROM app.memberships mm JOIN iharu_auth.members ma ON ma.id=mm.member_id JOIN iharu_auth."user" u ON u.id=ma.auth_user_id
   LEFT JOIN app.child_grants cg ON cg.child_id=cid AND cg.member_id=mm.member_id WHERE mm.family_id=ch.family_id AND mm.status='ACTIVE';
   RETURN jsonb_build_object('grants',result);
  ELSIF op='grants.put' THEN
   target:=(p->>'memberId')::uuid;
   IF target=ch.consenter_id THEN RAISE EXCEPTION 'CONSENTER_REQUIRED'; END IF;
   IF NOT EXISTS(SELECT 1 FROM app.memberships WHERE family_id=ch.family_id AND member_id=target AND status='ACTIVE') THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
   SELECT * INTO g FROM app.child_grants WHERE child_id=cid AND member_id=target FOR UPDATE;
   IF coalesce(g.version,0)<>(p->>'expectedVersion')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   IF (p->>'location')::boolean AND NOT EXISTS(SELECT 1 FROM app.child_consents WHERE child_id=cid AND purpose='location' AND revoked_at IS NULL) THEN RAISE EXCEPTION 'LOCATION_CONSENT_REQUIRED'; END IF;
   INSERT INTO app.child_grants(family_id,child_id,member_id,daily,chat,location,tuition_read,tuition_write,approved_by,starts_seq)
   VALUES(ch.family_id,cid,target,(p->>'daily')::bool,(p->>'chat')::bool,(p->>'location')::bool,(p->>'tuitionRead')::bool,(p->>'tuitionWrite')::bool,actor,(SELECT last_seq+1 FROM app.rooms WHERE child_id=cid))
   ON CONFLICT(child_id,member_id) DO UPDATE SET daily=excluded.daily,chat=excluded.chat,location=excluded.location,tuition_read=excluded.tuition_read,tuition_write=excluded.tuition_write,
   starts_seq=CASE WHEN NOT app.child_grants.chat AND excluded.chat THEN excluded.starts_seq ELSE app.child_grants.starts_seq END,
   starts_at=CASE WHEN NOT app.child_grants.chat AND excluded.chat THEN now_at ELSE app.child_grants.starts_at END,version=app.child_grants.version+1;
   IF coalesce(g.chat,false) IS DISTINCT FROM (p->>'chat')::bool THEN UPDATE app.rooms SET epoch=epoch+1 WHERE child_id=cid; END IF;
   PERFORM app_private.record_event('GRANTS_CHANGED',cid,true); RETURN jsonb_build_object('version',coalesce(g.version,0)+1);
  ELSIF op='devices.list' THEN
   SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'label',d.label,'status',d.status,'lastSeenAt',d.last_seen_at) ORDER BY d.last_seen_at DESC),'[]') INTO result FROM app.child_devices d WHERE d.child_id=cid AND d.status='ACTIVE' AND d.expires_at>now_at;
   RETURN jsonb_build_object('devices',result);
  ELSIF op='device.revoke' THEN
   UPDATE app.child_devices SET status='REVOKED',session_epoch=session_epoch+1 WHERE id=(p->>'deviceId')::uuid AND child_id=cid RETURNING id INTO target;
   IF target IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   UPDATE app_private.device_pairings SET sealed_response=NULL,state='REVOKED' WHERE device_id=target;
   PERFORM app_private.record_event('DEVICE_REVOKED',target,true); RETURN jsonb_build_object('status','REVOKED');
  ELSIF op='consents.get' THEN
   SELECT jsonb_agg(jsonb_build_object('purpose',purpose,'policyVersion',policy_version,'grantedAt',granted_at,'revokedAt',revoked_at)) INTO result FROM app.child_consents WHERE child_id=cid;
   RETURN jsonb_build_object('consents',result,'version',ch.version);
  END IF;
  IF ch.version<>(p->>'expectedVersion')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  UPDATE app.child_consents SET revoked_at=now_at WHERE child_id=cid AND purpose=p->>'purpose' AND revoked_at IS NULL;
  UPDATE app.children SET version=version+1,consent_epoch=consent_epoch+1 WHERE id=cid;
  IF p->>'purpose'='general' THEN
   UPDATE app.children SET status='REVOKED' WHERE id=cid;
   UPDATE app.child_devices SET status='REVOKED',session_epoch=session_epoch+1 WHERE child_id=cid;
   UPDATE app_private.device_pairings SET sealed_response=NULL,state='REVOKED' WHERE child_id=cid;
   UPDATE app.rooms SET epoch=epoch+1 WHERE child_id=cid;
   INSERT INTO app_private.deletion_requests(child_id) VALUES(cid) ON CONFLICT DO NOTHING;
   PERFORM app_private.record_event('GENERAL_CONSENT_REVOKED',cid,true);
  ELSE
   UPDATE app.child_grants SET location=false,version=version+1 WHERE child_id=cid;
   PERFORM app_private.record_event('LOCATION_CONSENT_REVOKED',cid,true);
  END IF;
  RETURN jsonb_build_object('status','REVOKED','version',ch.version+1);
 ELSIF op='pair.start' THEN
  UPDATE app_private.device_pairings SET state='REVOKED',sealed_response=NULL WHERE proof_hash=p->>'previousProofHash' AND state<>'EXCHANGED';
  UPDATE app_private.device_pairings SET state='REVOKED',sealed_response=NULL WHERE expires_at<=now_at AND state IN ('WAITING','APPROVED');
  UPDATE app_private.device_pairings SET sealed_response=NULL WHERE retry_until<=now_at AND sealed_response IS NOT NULL;
  INSERT INTO app_private.device_pairings(code_hash,proof_hash,label) VALUES(p->>'codeHash',p->>'proofHash',p->>'label') RETURNING * INTO pairing;
  RETURN jsonb_build_object('id',pairing.id,'expiresAt',pairing.expires_at,'version',pairing.version);
 ELSIF op='pair.resolve' THEN
  SELECT * INTO pairing FROM app_private.device_pairings WHERE code_hash=p->>'codeHash' AND state IN ('WAITING','APPROVED') AND expires_at>now_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'CODE_INVALID'; END IF;
  RETURN jsonb_build_object('id',pairing.id,'label',pairing.label,'version',pairing.version,'expiresAt',pairing.expires_at);
 ELSIF op IN ('pair.approve','pair.status','pair.exchange') THEN
  SELECT * INTO pairing FROM app_private.device_pairings WHERE id=(p->>'pairingId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAIRING_INVALID'; END IF;
  IF op='pair.approve' THEN
   IF pairing.state<>'WAITING' OR pairing.expires_at<=now_at OR pairing.version<>(p->>'expectedVersion')::int THEN RAISE EXCEPTION 'PAIRING_INVALID'; END IF;
   cid:=(p->>'childId')::uuid;
   SELECT * INTO ch FROM app.children WHERE id=cid FOR UPDATE;
   IF NOT app_private.child_allowed(cid,'manage') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF (SELECT count(*) FROM app.child_devices WHERE child_id=cid AND status='ACTIVE' AND expires_at>now_at)>=2 THEN RAISE EXCEPTION 'DEVICE_LIMIT'; END IF;
   UPDATE app_private.device_pairings SET state='APPROVED',family_id=ch.family_id,child_id=cid,approved_by=actor,version=version+1 WHERE id=pairing.id;
   PERFORM app_private.record_event('PAIRING_APPROVED',pairing.id); RETURN jsonb_build_object('status','APPROVED');
  END IF;
  IF pairing.proof_hash IS DISTINCT FROM p->>'proofHash' OR pairing.state='REVOKED' THEN RAISE EXCEPTION 'PAIRING_INVALID'; END IF;
  IF op='pair.status' THEN
   RETURN jsonb_build_object('status',CASE WHEN pairing.expires_at<=now_at THEN 'EXPIRED' ELSE pairing.state END,'expiresAt',pairing.expires_at);
  END IF;
  IF pairing.state='EXCHANGED' THEN
   IF pairing.retry_until<=now_at OR pairing.exchange_key IS DISTINCT FROM (p->>'exchangeKey')::uuid OR pairing.sealed_response IS NULL
   OR NOT EXISTS(SELECT 1 FROM app.child_devices d JOIN app.children c ON c.id=d.child_id WHERE d.id=pairing.device_id AND d.status='ACTIVE' AND d.expires_at>now_at AND c.status='ACTIVE') THEN RAISE EXCEPTION 'PAIRING_RESTART'; END IF;
   RETURN jsonb_build_object('sealed',pairing.sealed_response);
  END IF;
  IF pairing.expires_at<=now_at OR pairing.state<>'APPROVED' THEN RAISE EXCEPTION 'PAIRING_INVALID'; END IF;
  SELECT * INTO ch FROM app.children WHERE id=pairing.child_id FOR UPDATE;
  IF ch.status<>'ACTIVE' OR NOT EXISTS(SELECT 1 FROM app.child_consents WHERE child_id=ch.id AND purpose='general' AND revoked_at IS NULL)
  OR NOT EXISTS(SELECT 1 FROM app.memberships mm JOIN iharu_auth.members ma ON ma.id=mm.member_id WHERE mm.family_id=ch.family_id AND mm.member_id=pairing.approved_by AND mm.status='ACTIVE' AND ma.status='ACTIVE' AND ma.access_ready)
  OR ch.consenter_id<>pairing.approved_by THEN RAISE EXCEPTION 'PAIRING_INVALID'; END IF;
  IF (SELECT count(*) FROM app.child_devices WHERE child_id=ch.id AND status='ACTIVE' AND expires_at>now_at)>=2 THEN RAISE EXCEPTION 'DEVICE_LIMIT'; END IF;
  INSERT INTO app.child_devices(family_id,child_id,label,token_hash) VALUES(ch.family_id,ch.id,pairing.label,p->>'deviceHash') RETURNING * INTO device;
  UPDATE app_private.device_pairings SET state='EXCHANGED',device_id=device.id,exchange_key=(p->>'exchangeKey')::uuid,sealed_response=p->>'sealed',retry_until=now_at+interval '2 minutes' WHERE id=pairing.id;
  PERFORM app_private.record_event('DEVICE_CONNECTED',device.id); RETURN jsonb_build_object('sealed',p->>'sealed');
 ELSIF op IN ('child.session','child.logout') THEN
  SELECT * INTO device FROM app.child_devices WHERE token_hash=nullif(current_setting('iharu.device_hash',true),'') AND status='ACTIVE' AND expires_at>now_at AND last_seen_at>now_at-interval '7 days' FOR UPDATE;
  IF NOT FOUND OR NOT app_private.child_allowed(device.child_id) THEN RAISE EXCEPTION 'DEVICE_REQUIRED'; END IF;
  IF op='child.logout' THEN
   UPDATE app.child_devices SET status='REVOKED',session_epoch=session_epoch+1 WHERE id=device.id;
   UPDATE app_private.device_pairings SET sealed_response=NULL,state='REVOKED' WHERE device_id=device.id;
   PERFORM app_private.record_event('DEVICE_REVOKED',device.id,true); RETURN jsonb_build_object('status','REVOKED');
  END IF;
  UPDATE app.child_devices SET last_seen_at=now_at WHERE id=device.id;
  SELECT * INTO ch FROM app.children WHERE id=device.child_id;
  RETURN jsonb_build_object('id',device.id,'childId',ch.id,'nickname',ch.nickname,'locationAllowed',app_private.child_allowed(ch.id,'location'));
 END IF;
 RAISE EXCEPTION 'UNKNOWN_OPERATION';
END $$;
ALTER FUNCTION app_private.record_event(text,uuid,boolean) OWNER TO iharu_policy;
ALTER FUNCTION app_private.family_command(text,jsonb) OWNER TO iharu_policy;
REVOKE ALL ON FUNCTION app_private.record_event(text,uuid,boolean),app_private.family_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.family_command(text,jsonb) TO app_runtime;

REVOKE CREATE ON SCHEMA app_private FROM iharu_policy;
