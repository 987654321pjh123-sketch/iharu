-- Run function ACL changes as their NOLOGIN owner. Supabase's postgres is not a superuser.
-- A migration role needs SET membership in iharu_policy; INHERIT is not required.
ALTER FUNCTION app_private.actor() SET search_path=pg_catalog,pg_temp;
DO $acl$
DECLARE migration_role name := current_user; restricted_role text;
BEGIN
 EXECUTE 'SET LOCAL ROLE iharu_policy';
 REVOKE ALL ON FUNCTION
  app_private.guardian_ready(),app_private.member_of(uuid),app_private.child_allowed(uuid,text),
  app_private.record_event(text,uuid,boolean),app_private.family_command(text,jsonb),
  app_private.record_relationship_result(uuid,text,text,date,text,boolean),
  app_private.capture_revocation_scope(),app_private.expire_family_secrets()
 FROM PUBLIC,app_runtime;
 FOREACH restricted_role IN ARRAY ARRAY['anon','authenticated','service_role','auth_runtime','verification_runtime','worker_runtime'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=restricted_role) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION app_private.guardian_ready(),app_private.member_of(uuid),app_private.child_allowed(uuid,text),app_private.record_event(text,uuid,boolean),app_private.family_command(text,jsonb),app_private.record_relationship_result(uuid,text,text,date,text,boolean),app_private.capture_revocation_scope(),app_private.expire_family_secrets() FROM %I',restricted_role);
  END IF;
 END LOOP;
 GRANT EXECUTE ON FUNCTION app_private.member_of(uuid),app_private.child_allowed(uuid,text),app_private.family_command(text,jsonb) TO app_runtime;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='verification_runtime') THEN
  GRANT EXECUTE ON FUNCTION app_private.record_relationship_result(uuid,text,text,date,text,boolean) TO verification_runtime;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_runtime') THEN
  GRANT EXECUTE ON FUNCTION app_private.expire_family_secrets() TO worker_runtime;
 END IF;
 ALTER DEFAULT PRIVILEGES FOR ROLE iharu_policy REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
 PERFORM set_config('role',migration_role,true);
END $acl$;
DO $verify$
BEGIN
 IF has_function_privilege('app_runtime','app_private.record_relationship_result(uuid,text,text,date,text,boolean)','EXECUTE')
 OR has_function_privilege('app_runtime','app_private.expire_family_secrets()','EXECUTE')
 OR NOT has_function_privilege('app_runtime','app_private.family_command(text,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'UNSAFE_FUNCTION_PERMISSIONS'; END IF;
END $verify$;
