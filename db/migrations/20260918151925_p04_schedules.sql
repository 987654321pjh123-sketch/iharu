-- P04: stable occurrences, dated recurrence versions and purpose-scoped access.
-- No credentials or real child fixtures. Apply with the dedicated migration identity.
CREATE TABLE app.schedule_series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL, child_id uuid NOT NULL,
 first_date date NOT NULL, last_date date NOT NULL CHECK(last_date>=first_date AND last_date<=first_date+interval '1 year'),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 makeup_for_occurrence_id uuid UNIQUE,
 UNIQUE(family_id,child_id,id), FOREIGN KEY(family_id,child_id) REFERENCES app.children(family_id,id)
);
CREATE TABLE app.schedule_series_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), series_id uuid NOT NULL REFERENCES app.schedule_series(id),
 from_date date NOT NULL, until_date date NOT NULL CHECK(until_date>=from_date),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 80), place text NOT NULL CHECK(length(place)<=120),
 frequency text NOT NULL CHECK(frequency IN ('ONCE','WEEKLY')), weekdays integer[] NOT NULL CHECK(cardinality(weekdays) BETWEEN 1 AND 7 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]),
 start_time time NOT NULL, end_time time NOT NULL CHECK(end_time>start_time),
 holiday_policy text NOT NULL DEFAULT 'ASK' CHECK(holiday_policy IN ('KEEP','SKIP','ASK')),
 UNIQUE(series_id,from_date)
);
CREATE TABLE app.occurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), family_id uuid NOT NULL, child_id uuid NOT NULL, series_id uuid NOT NULL,
 local_date date NOT NULL, actual_date date NOT NULL, title text NOT NULL, place text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 status text NOT NULL CHECK(status IN ('SCHEDULED','NEEDS_CONFIRMATION','SKIPPED','CANCELLED')), reason text,
 holiday_names text[] NOT NULL DEFAULT '{}', holiday_state text NOT NULL DEFAULT 'UNKNOWN', holiday_version integer NOT NULL DEFAULT 0,
 holiday_review_required boolean NOT NULL DEFAULT false, override boolean NOT NULL DEFAULT false,
 protected_at timestamptz, version integer NOT NULL DEFAULT 1, closed_at timestamptz,
 UNIQUE(series_id,local_date), UNIQUE(family_id,child_id,id),
 FOREIGN KEY(family_id,child_id,series_id) REFERENCES app.schedule_series(family_id,child_id,id)
);
ALTER TABLE app.schedule_series ADD FOREIGN KEY(family_id,child_id,makeup_for_occurrence_id) REFERENCES app.occurrences(family_id,child_id,id);
CREATE TABLE app.occurrence_exceptions (
 occurrence_id uuid PRIMARY KEY REFERENCES app.occurrences(id), changes jsonb NOT NULL DEFAULT '{}',
 decision text CHECK(decision IN ('KEEP','SKIP')), reason text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.schedule_closures (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), series_id uuid NOT NULL REFERENCES app.schedule_series(id),
 from_date date NOT NULL, until_date date NOT NULL CHECK(until_date>=from_date),
 kind text NOT NULL CHECK(kind IN ('BREAK','VACATION')), reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 80),
 revoked_at timestamptz
);
CREATE TABLE app_private.holiday_years (
 year integer PRIMARY KEY CHECK(year BETWEEN 2020 AND 2199), state text NOT NULL DEFAULT 'UNKNOWN' CHECK(state IN ('UNKNOWN','READY','FAILED')),
 version integer NOT NULL DEFAULT 0, source_hash text, last_success_at timestamptz
);
CREATE TABLE app_private.holidays (
 year integer NOT NULL REFERENCES app_private.holiday_years(year), local_date date NOT NULL, name text NOT NULL,
 is_holiday boolean NOT NULL, PRIMARY KEY(year,local_date,name), CHECK(extract(year FROM local_date)=year)
);
CREATE TABLE app_private.holiday_sync_runs (
 year integer NOT NULL, run_date date NOT NULL, state text NOT NULL, lease_token uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, retry_after timestamptz, error_code text, PRIMARY KEY(year,run_date)
);
CREATE TABLE app_private.schedule_jobs (
 job_key text PRIMARY KEY, cursor_id uuid, done boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_private.schedule_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL, session_id text NOT NULL, occurrence_id uuid NOT NULL REFERENCES app.occurrences(id),
 payload jsonb NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE TABLE app_private.schedule_idempotency (
 actor_id uuid NOT NULL, key text NOT NULL, operation text NOT NULL, payload jsonb NOT NULL, response jsonb,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', PRIMARY KEY(actor_id,key)
);
-- P07 consumes these IDs after rechecking recipient permission. No message/location payloads.
CREATE TABLE app_private.schedule_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), child_id uuid NOT NULL REFERENCES app.children(id),
 target_id uuid NOT NULL, kind text NOT NULL, resource_version integer NOT NULL,
 state text NOT NULL DEFAULT 'PENDING', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(target_id,kind,resource_version)
);
CREATE INDEX schedules_child ON app.schedule_series(child_id,id);
CREATE INDEX occurrences_child_time ON app.occurrences(child_id,starts_at,id);
CREATE INDEX schedule_closure_range ON app.schedule_closures(series_id,from_date,until_date) WHERE revoked_at IS NULL;
CREATE INDEX schedule_events_pending ON app_private.schedule_events(state,created_at,id);
CREATE INDEX schedule_preview_expiry ON app_private.schedule_previews(expires_at);
CREATE INDEX schedule_idempotency_expiry ON app_private.schedule_idempotency(expires_at);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['schedule_series','schedule_series_versions','occurrences','occurrence_exceptions','schedule_closures'] LOOP
  EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY policy_executor ON app.%I TO iharu_policy USING (true) WITH CHECK (true)',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON app.%I TO iharu_policy',t);
 END LOOP;
END $$;

CREATE POLICY daily_series_read ON app.schedule_series FOR SELECT TO app_runtime USING(app_private.child_allowed(child_id,'daily'));
CREATE POLICY daily_occurrence_read ON app.occurrences FOR SELECT TO app_runtime USING(app_private.child_allowed(child_id,'daily'));
GRANT SELECT ON app.schedule_series,app.occurrences TO app_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON app_private.holiday_years,app_private.holidays,app_private.holiday_sync_runs,app_private.schedule_jobs,app_private.schedule_previews,app_private.schedule_idempotency,app_private.schedule_events TO iharu_policy;
GRANT CREATE ON SCHEMA app_private TO iharu_policy;

CREATE FUNCTION app_private.check_schedule_version() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM 1 FROM app.schedule_series WHERE id=NEW.series_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM app.schedule_series_versions v WHERE v.series_id=NEW.series_id AND v.id<>NEW.id
 AND daterange(v.from_date,v.until_date,'[]') && daterange(NEW.from_date,NEW.until_date,'[]')) THEN RAISE EXCEPTION 'VERSION_RANGE_OVERLAP'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER schedule_version_nonoverlap BEFORE INSERT OR UPDATE ON app.schedule_series_versions FOR EACH ROW EXECUTE FUNCTION app_private.check_schedule_version();

CREATE FUNCTION app_private.holiday_state(y integer) RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT coalesce((SELECT CASE WHEN last_success_at IS NULL THEN 'UNKNOWN' WHEN state='READY' AND last_success_at>now()-interval '36 hours' THEN 'READY' ELSE 'STALE' END FROM app_private.holiday_years WHERE year=y),'UNKNOWN')
$$;

-- Called under the non-login policy role; never directly executable by web DB roles.
CREATE FUNCTION app_private.expand_schedule(sid uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE s app.schedule_series%ROWTYPE; v app.schedule_series_versions%ROWTYPE; o app.occurrences%ROWTYPE;
 ex app.occurrence_exceptions%ROWTYPE; d date; actual date; local_today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
 st timestamptz; en timestamptz; title_value text; place_value text; names text[]; hstate text; hv integer;
 result_status text; why text; closure_reason text; changed boolean:=false; needs_review boolean; applies boolean;
BEGIN
 SELECT * INTO s FROM app.schedule_series WHERE id=sid FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 FOR d IN
  SELECT x::date FROM generate_series(local_today::timestamp,(local_today+55)::timestamp,interval '1 day') x
  UNION SELECT old.local_date FROM app.occurrences old WHERE old.series_id=sid AND old.local_date<local_today
   AND old.actual_date BETWEEN local_today AND local_today+55 AND old.starts_at>now()
 LOOP
  SELECT * INTO v FROM app.schedule_series_versions WHERE series_id=sid AND d BETWEEN from_date AND until_date;
  applies:=FOUND AND (v.frequency='ONCE' AND d=v.from_date OR v.frequency='WEEKLY' AND extract(dow FROM d)::int=ANY(v.weekdays));
  SELECT * INTO o FROM app.occurrences WHERE series_id=sid AND local_date=d;
  IF o.id IS NOT NULL AND (o.protected_at IS NOT NULL OR o.starts_at<=now()) THEN CONTINUE; END IF;
  SELECT * INTO ex FROM app.occurrence_exceptions WHERE occurrence_id=o.id;
  IF NOT applies AND ex.occurrence_id IS NULL THEN
   IF o.id IS NOT NULL AND (o.status<>'CANCELLED' OR o.reason IS DISTINCT FROM '반복 요일·기간 변경') THEN
    UPDATE app.occurrences SET status='CANCELLED',reason='반복 요일·기간 변경',closed_at=now(),version=version+1 WHERE id=o.id; changed:=true;
   END IF;
   CONTINUE;
  END IF;
  IF NOT applies AND ex.occurrence_id IS NOT NULL THEN
   -- Keep exceptions on removed weekdays; a later explicit ONE edit still applies.
   v.title:=o.title;v.place:=o.place;v.start_time:=(o.starts_at AT TIME ZONE 'Asia/Seoul')::time;
   v.end_time:=(o.ends_at AT TIME ZONE 'Asia/Seoul')::time;v.holiday_policy:='ASK';
  END IF;
  actual:=coalesce((ex.changes->>'date')::date,d);
  title_value:=coalesce(ex.changes->>'title',v.title);place_value:=coalesce(ex.changes->>'place',v.place);
  st:=(actual+coalesce((ex.changes->>'startTime')::time,v.start_time)) AT TIME ZONE 'Asia/Seoul';
  en:=(actual+coalesce((ex.changes->>'endTime')::time,v.end_time)) AT TIME ZONE 'Asia/Seoul';
  SELECT coalesce(array_agg(name ORDER BY name),'{}') INTO names FROM app_private.holidays WHERE local_date=actual AND is_holiday;
  hstate:=app_private.holiday_state(extract(year FROM actual)::int);
  SELECT coalesce(version,0) INTO hv FROM app_private.holiday_years WHERE year=extract(year FROM actual)::int;
  hv:=coalesce(hv,0);
  needs_review:=coalesce(o.holiday_review_required,false) OR (o.id IS NOT NULL AND o.holiday_state='READY' AND cardinality(o.holiday_names)=0 AND cardinality(names)>0);
  SELECT reason INTO closure_reason FROM app.schedule_closures WHERE series_id=sid AND actual BETWEEN from_date AND until_date AND revoked_at IS NULL ORDER BY from_date,id LIMIT 1;
  why:=NULL;
  IF coalesce((ex.changes->>'cancelled')::bool,false) THEN result_status:='CANCELLED';why:=ex.reason;
  ELSIF ex.decision IS NOT NULL THEN result_status:=CASE ex.decision WHEN 'KEEP' THEN 'SCHEDULED' ELSE 'SKIPPED' END;why:=CASE ex.decision WHEN 'SKIP' THEN '보호자가 휴강으로 확인' ELSE '보호자가 정상 진행으로 확인' END;needs_review:=false;
  ELSIF closure_reason IS NOT NULL THEN result_status:='SKIPPED';why:='기관 휴무 · '||closure_reason;
  ELSIF hstate<>'READY' THEN result_status:='NEEDS_CONFIRMATION';why:='공휴일 정보 확인 필요';
  ELSIF needs_review THEN result_status:='NEEDS_CONFIRMATION';why:='공휴일 정보 변경 · 진행 확인 필요';
  ELSIF cardinality(names)>0 THEN
   result_status:=CASE coalesce(ex.changes->>'holidayPolicy',v.holiday_policy) WHEN 'KEEP' THEN 'SCHEDULED' WHEN 'SKIP' THEN 'SKIPPED' ELSE 'NEEDS_CONFIRMATION' END;
   why:=CASE result_status WHEN 'SKIPPED' THEN '공휴일 휴강 정책' WHEN 'NEEDS_CONFIRMATION' THEN '공휴일 진행 확인 필요' ELSE NULL END;
  ELSE result_status:='SCHEDULED'; END IF;
  IF o.id IS NULL THEN
   INSERT INTO app.occurrences(family_id,child_id,series_id,local_date,actual_date,title,place,starts_at,ends_at,status,reason,holiday_names,holiday_state,holiday_version)
   VALUES(s.family_id,s.child_id,sid,d,actual,title_value,place_value,st,en,result_status,why,names,hstate,hv) ON CONFLICT(series_id,local_date) DO NOTHING;changed:=true;
  ELSIF ROW(o.actual_date,o.title,o.place,o.starts_at,o.ends_at,o.status,o.reason,o.holiday_names,o.holiday_state,o.holiday_version,o.override,o.holiday_review_required)
    IS DISTINCT FROM ROW(actual,title_value,place_value,st,en,result_status,why,names,hstate,hv,ex.occurrence_id IS NOT NULL,needs_review) THEN
   UPDATE app.occurrences SET actual_date=actual,title=title_value,place=place_value,starts_at=st,ends_at=en,status=result_status,reason=why,holiday_names=names,holiday_state=hstate,holiday_version=hv,override=ex.occurrence_id IS NOT NULL,holiday_review_required=needs_review,version=version+1,
    closed_at=CASE WHEN result_status IN ('CANCELLED','SKIPPED') THEN coalesce(closed_at,now()) ELSE NULL END WHERE id=o.id;changed:=true;
   IF needs_review AND NOT o.holiday_review_required THEN INSERT INTO app_private.schedule_events(child_id,target_id,kind,resource_version) VALUES(s.child_id,o.id,'HOLIDAY_REVIEW',o.version+1) ON CONFLICT DO NOTHING; END IF;
  END IF;
 END LOOP;
 IF changed THEN UPDATE app.schedule_series SET version=version+1 WHERE id=sid; END IF;
END $$;

CREATE FUNCTION app_private.occurrence_dto(o app.occurrences) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('id',o.id,'seriesId',o.series_id,'childId',o.child_id,'childName',c.nickname,
 'date',o.actual_date,'anchorDate',o.local_date,'title',o.title,'place',o.place,'startTime',to_char(o.starts_at AT TIME ZONE 'Asia/Seoul','HH24:MI'),'endTime',to_char(o.ends_at AT TIME ZONE 'Asia/Seoul','HH24:MI'),
 'startsAt',o.starts_at,'endsAt',o.ends_at,'status',o.status,'reason',o.reason,'holidayNames',o.holiday_names,'holidayState',o.holiday_state,'override',o.override,
 'locked',o.protected_at IS NOT NULL OR o.starts_at<=now(),'makeupForOccurrenceId',s.makeup_for_occurrence_id,'version',o.version,'resourceVersion',s.version,
 'allowedActions',CASE WHEN app_private.guardian_ready() THEN
  (CASE WHEN o.protected_at IS NULL AND o.starts_at>now() THEN '["EDIT","DECIDE"]'::jsonb ELSE '[]'::jsonb END) ||
  (CASE WHEN o.status IN ('CANCELLED','SKIPPED') THEN '["MAKEUP"]'::jsonb ELSE '[]'::jsonb END) ELSE '[]'::jsonb END,
 'missingAttendanceSuppressed',o.status<>'SCHEDULED') FROM app.children c JOIN app.schedule_series s ON s.child_id=c.id WHERE s.id=o.series_id
$$;

CREATE FUNCTION app_private.schedule_command(op text,p jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor uuid:=app_private.actor(); cid uuid; fid uuid; sid uuid; target uuid; today date:=(now() AT TIME ZONE 'Asia/Seoul')::date;
 lo date; hi date; effective date; finish date; next_date date; key_value text; is_read boolean:=op IN ('calendar','children','series.list','child.list','occurrence.get');
 s app.schedule_series%ROWTYPE; v app.schedule_series_versions%ROWTYPE; o app.occurrences%ROWTYPE; preview app_private.schedule_previews%ROWTYPE;
 idem app_private.schedule_idempotency%ROWTYPE; ch jsonb; result jsonb; items jsonb; counts jsonb; holidays jsonb; years jsonb; last_cursor uuid;
 affected integer; exceptions integer; protected integer; later integer; overlap_count integer; new_start time; new_end time; dates integer[];
BEGIN
 IF NOT is_read AND NOT app_private.guardian_ready() THEN RAISE EXCEPTION 'ACCESS_NOT_READY'; END IF;
 IF op IN ('calendar','children','series.list') THEN
  fid:=(p->>'familyId')::uuid;
  IF NOT app_private.member_of(fid) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  cid:=(p->>'childId')::uuid;
  IF cid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.children WHERE id=cid AND family_id=fid AND app_private.child_allowed(id,'daily')) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 ELSIF op IN ('child.list','create') THEN
  cid:=(p->>'childId')::uuid;
  IF NOT app_private.child_allowed(cid,'daily') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT family_id INTO fid FROM app.children WHERE id=cid;
 ELSIF op IN ('closure.create','closure.remove') THEN
  SELECT * INTO s FROM app.schedule_series WHERE id=(p->>'seriesId')::uuid;
  IF NOT FOUND OR NOT app_private.child_allowed(s.child_id,'daily') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  cid:=s.child_id;fid:=s.family_id;sid:=s.id;
 ELSE
  SELECT * INTO o FROM app.occurrences WHERE id=(p->>'occurrenceId')::uuid;
  IF NOT FOUND OR NOT app_private.child_allowed(o.child_id,'daily') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  cid:=o.child_id;fid:=o.family_id;sid:=o.series_id;
 END IF;
 IF op='children' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'nickname',nickname) ORDER BY created_at),'[]') INTO items
  FROM app.children WHERE family_id=fid AND app_private.child_allowed(id,'daily');
  RETURN jsonb_build_object('children',items,'serverToday',today);
 END IF;
 IF op IN ('calendar','child.list') THEN
  lo:=(p->>'from')::date;hi:=(p->>'to')::date;
  IF lo IS NULL OR hi IS NULL OR hi<lo OR hi-lo>55 OR lo<today-90 OR hi>today+55 THEN RAISE EXCEPTION 'INVALID_RANGE'; END IF;
  FOR sid IN SELECT id FROM app.schedule_series WHERE family_id=fid AND (cid IS NULL OR child_id=cid) AND app_private.child_allowed(child_id,'daily') AND last_date>=today ORDER BY id LOOP
   PERFORM app_private.expand_schedule(sid);
  END LOOP;
  IF p->>'cursor' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app.occurrences WHERE id=(p->>'cursor')::uuid AND family_id=fid AND (cid IS NULL OR child_id=cid) AND app_private.child_allowed(child_id,'daily') AND actual_date BETWEEN lo AND hi) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT coalesce(jsonb_agg(app_private.occurrence_dto(x) ORDER BY x.starts_at,x.id),'[]') INTO items FROM (
   SELECT oc.* FROM app.occurrences oc WHERE oc.family_id=fid AND (cid IS NULL OR oc.child_id=cid) AND app_private.child_allowed(oc.child_id,'daily') AND oc.actual_date BETWEEN lo AND hi
   AND (p->>'cursor' IS NULL OR (oc.starts_at,oc.id)>(SELECT z.starts_at,z.id FROM app.occurrences z WHERE z.id=(p->>'cursor')::uuid))
   ORDER BY oc.starts_at,oc.id LIMIT least(greatest(coalesce((p->>'limit')::int,50),1),50)+1
  ) x;
  IF jsonb_array_length(items)>least(greatest(coalesce((p->>'limit')::int,50),1),50) THEN
   items:=items-(jsonb_array_length(items)-1);last_cursor:=(items->(jsonb_array_length(items)-1)->>'id')::uuid;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',x.actual_date,'count',x.n,'active',x.active) ORDER BY x.actual_date),'[]') INTO counts FROM (
   SELECT actual_date,count(*) n,count(*) FILTER(WHERE status='SCHEDULED') active FROM app.occurrences WHERE family_id=fid AND (cid IS NULL OR child_id=cid) AND app_private.child_allowed(child_id,'daily') AND actual_date BETWEEN lo AND hi GROUP BY actual_date
  ) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('date',local_date,'name',name) ORDER BY local_date,name),'[]') INTO holidays FROM app_private.holidays WHERE local_date BETWEEN lo AND hi AND is_holiday;
  SELECT jsonb_agg(jsonb_build_object('year',y,'state',app_private.holiday_state(y),'version',coalesce(h.version,0),'lastSuccessAt',h.last_success_at)) INTO years FROM generate_series(extract(year FROM lo)::int,extract(year FROM hi)::int) y LEFT JOIN app_private.holiday_years h ON h.year=y;
  RETURN jsonb_build_object('occurrences',items,'nextCursor',last_cursor,'dayCounts',counts,'holidays',holidays,'holidayYears',years,'serverToday',today,'horizonEnd',today+55);
 ELSIF op='series.list' THEN
  FOR sid IN SELECT id FROM app.schedule_series WHERE family_id=fid AND (cid IS NULL OR child_id=cid) AND app_private.child_allowed(child_id,'daily') AND last_date>=today ORDER BY id LOOP
   PERFORM app_private.expand_schedule(sid);
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'childId',x.child_id,'childName',x.nickname,'resourceVersion',x.version,'fromDate',x.first_date,'untilDate',x.last_date,
   'versions',(SELECT jsonb_agg(jsonb_build_object('fromDate',vv.from_date,'untilDate',vv.until_date,'title',vv.title,'place',vv.place,'startTime',to_char(vv.start_time,'HH24:MI'),'endTime',to_char(vv.end_time,'HH24:MI'),'frequency',vv.frequency,'weekdays',vv.weekdays,'holidayPolicy',vv.holiday_policy) ORDER BY vv.from_date) FROM app.schedule_series_versions vv WHERE vv.series_id=x.id),
   'closures',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',b.id,'from',b.from_date,'to',b.until_date,'kind',b.kind,'reason',b.reason) ORDER BY b.from_date),'[]') FROM app.schedule_closures b WHERE b.series_id=x.id AND b.revoked_at IS NULL)) ORDER BY x.id),'[]') INTO items
  FROM (SELECT ss.*,cc.nickname FROM app.schedule_series ss JOIN app.children cc ON cc.id=ss.child_id WHERE ss.family_id=fid AND (cid IS NULL OR ss.child_id=cid) AND app_private.child_allowed(ss.child_id,'daily') AND (p->>'cursor' IS NULL OR ss.id>(p->>'cursor')::uuid) ORDER BY ss.id LIMIT 51) x;
  IF jsonb_array_length(items)>50 THEN items:=items-50;last_cursor:=(items->49->>'id')::uuid; END IF;
  RETURN jsonb_build_object('series',items,'nextCursor',last_cursor);
 ELSIF op='occurrence.get' THEN
  PERFORM app_private.expand_schedule(sid);SELECT * INTO o FROM app.occurrences WHERE id=o.id;
  RETURN jsonb_build_object('occurrence',app_private.occurrence_dto(o));
 END IF;
 -- Serialize create and mutations with child consent/grant changes. Recheck after lock.
 PERFORM 1 FROM app.children WHERE id=cid FOR UPDATE;
 IF NOT app_private.guardian_ready() OR NOT app_private.child_allowed(cid,'daily') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF sid IS NOT NULL THEN PERFORM app_private.expand_schedule(sid);SELECT * INTO s FROM app.schedule_series WHERE id=sid FOR UPDATE; END IF;
 IF op<>'preview' THEN
  key_value:=p->>'key';IF key_value IS NULL OR length(key_value) NOT BETWEEN 8 AND 128 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(actor::text||':'||key_value,44)) THEN RAISE EXCEPTION 'REQUEST_IN_PROGRESS'; END IF;
  DELETE FROM app_private.schedule_idempotency WHERE actor_id=actor AND key=key_value AND expires_at<=now();
  SELECT * INTO idem FROM app_private.schedule_idempotency WHERE actor_id=actor AND key=key_value;
  IF FOUND THEN
   IF idem.operation<>op OR idem.payload IS DISTINCT FROM p-'key' THEN RAISE EXCEPTION 'KEY_REUSED'; END IF;
   IF idem.response IS NULL THEN RAISE EXCEPTION 'REQUEST_IN_PROGRESS'; END IF;
   RETURN idem.response;
  END IF;
  INSERT INTO app_private.schedule_idempotency(actor_id,key,operation,payload) VALUES(actor,key_value,op,p-'key');
 END IF;
 IF op='create' THEN
  lo:=(p->>'date')::date;hi:=(p->>'untilDate')::date;
  IF lo IS NULL OR hi IS NULL OR lo<today OR lo>today+interval '1 year' OR hi<lo OR hi>lo+interval '1 year'
   OR p->>'frequency'='ONCE' AND hi<>lo OR (p->>'endTime')::time<=(p->>'startTime')::time THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF (SELECT count(*) FROM app.schedule_series WHERE child_id=cid AND last_date>=today)>=100 THEN RAISE EXCEPTION 'SCHEDULE_LIMIT'; END IF;
  target:=(p->>'makeupForOccurrenceId')::uuid;
  IF target IS NOT NULL AND (p->>'frequency'<>'ONCE' OR NOT EXISTS(SELECT 1 FROM app.occurrences WHERE id=target AND child_id=cid AND family_id=fid AND status IN ('CANCELLED','SKIPPED'))) THEN RAISE EXCEPTION 'INVALID_TARGET'; END IF;
  IF target IS NOT NULL AND EXISTS(SELECT 1 FROM app.schedule_series WHERE makeup_for_occurrence_id=target) THEN RAISE EXCEPTION 'MAKEUP_EXISTS'; END IF;
  INSERT INTO app.schedule_series(family_id,child_id,first_date,last_date,makeup_for_occurrence_id) VALUES(fid,cid,lo,hi,target) RETURNING id INTO sid;
  INSERT INTO app.schedule_series_versions(series_id,from_date,until_date,title,place,frequency,weekdays,start_time,end_time,holiday_policy)
   VALUES(sid,lo,hi,p->>'title',p->>'place',p->>'frequency',ARRAY(SELECT jsonb_array_elements_text(p->'weekdays')::int),(p->>'startTime')::time,(p->>'endTime')::time,coalesce(p->>'holidayPolicy','ASK'));
 ELSIF op IN ('preview','change') THEN
  SELECT * INTO o FROM app.occurrences WHERE id=(p->>'occurrenceId')::uuid;
  IF s.version IS DISTINCT FROM (p->>'expectedVersion')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF o.protected_at IS NOT NULL OR o.starts_at<=now() THEN RAISE EXCEPTION 'PAST_RECORD_LOCKED'; END IF;
  effective:=(p->>'effectiveDate')::date;ch:=p->'changes';
  IF effective IS NULL OR effective<today OR p->>'scope' NOT IN ('ONE','FUTURE') OR ch IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p->>'scope'='ONE' THEN
   IF effective<>o.local_date OR ch ? 'untilDate' OR ch ? 'weekdays' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   lo:=coalesce((ch->>'date')::date,o.actual_date);
   new_start:=coalesce((ch->>'startTime')::time,(o.starts_at AT TIME ZONE 'Asia/Seoul')::time);
   new_end:=coalesce((ch->>'endTime')::time,(o.ends_at AT TIME ZONE 'Asia/Seoul')::time);
   IF lo<today OR lo>today+55 OR (lo+new_start) AT TIME ZONE 'Asia/Seoul'<=now() OR new_end<=new_start
    OR coalesce((ch->>'cancelled')::bool,false) AND coalesce(length(ch->>'reason'),0)=0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   affected:=1;exceptions:=CASE WHEN o.override THEN 1 ELSE 0 END;protected:=0;later:=0;
   SELECT count(*) INTO overlap_count FROM app.occurrences WHERE child_id=cid AND series_id<>sid AND status NOT IN ('CANCELLED','SKIPPED') AND starts_at<(lo+new_end) AT TIME ZONE 'Asia/Seoul' AND ends_at>(lo+new_start) AT TIME ZONE 'Asia/Seoul';
  ELSE
   IF ch ? 'date' OR ch ? 'cancelled' OR ch ? 'reason' OR effective>s.last_date THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   SELECT * INTO v FROM app.schedule_series_versions WHERE series_id=sid AND effective BETWEEN from_date AND until_date;
   IF NOT FOUND OR v.frequency<>'WEEKLY' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   finish:=coalesce((ch->>'untilDate')::date,CASE WHEN p->>'laterVersions'='REPLACE' THEN s.last_date ELSE v.until_date END);
   IF finish<effective OR finish>s.first_date+interval '1 year' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   new_start:=coalesce((ch->>'startTime')::time,v.start_time);new_end:=coalesce((ch->>'endTime')::time,v.end_time);
   IF new_end<=new_start THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   dates:=CASE WHEN ch ? 'weekdays' THEN ARRAY(SELECT jsonb_array_elements_text(ch->'weekdays')::int) ELSE v.weekdays END;
   SELECT count(*),min(from_date) INTO later,next_date FROM app.schedule_series_versions WHERE series_id=sid AND from_date>effective;
   IF coalesce(p->>'laterVersions','KEEP')<>'REPLACE' AND next_date IS NOT NULL THEN finish:=least(finish,next_date-1); END IF;
   hi:=least(today+55,CASE WHEN p->>'laterVersions'='REPLACE' THEN greatest(s.last_date,finish) ELSE greatest(v.until_date,finish) END);
   SELECT count(*) FILTER(WHERE override),count(*) FILTER(WHERE protected_at IS NOT NULL OR starts_at<=now()) INTO exceptions,protected FROM app.occurrences WHERE series_id=sid AND local_date BETWEEN effective AND hi;
   -- Include newly added weekdays as well as existing dates that will be changed/cancelled.
   WITH candidates AS (
    SELECT local_date d FROM app.occurrences WHERE series_id=sid AND local_date BETWEEN effective AND hi
    UNION SELECT d::date FROM generate_series(effective::timestamp,least(finish,today+55)::timestamp,interval '1 day') d WHERE extract(dow FROM d)::int=ANY(dates)
   ) SELECT count(*) INTO affected FROM candidates c LEFT JOIN app.occurrences x ON x.series_id=sid AND x.local_date=c.d
    WHERE coalesce(x.override,false)=false AND x.protected_at IS NULL AND coalesce(x.starts_at,(c.d+new_start) AT TIME ZONE 'Asia/Seoul')>now();
   SELECT count(*) INTO overlap_count FROM app.occurrences WHERE child_id=cid AND series_id<>sid AND status NOT IN ('CANCELLED','SKIPPED') AND actual_date BETWEEN effective AND least(finish,today+55) AND extract(dow FROM actual_date)::int=ANY(dates)
    AND (starts_at AT TIME ZONE 'Asia/Seoul')::time<new_end AND (ends_at AT TIME ZONE 'Asia/Seoul')::time>new_start;
  END IF;
  IF op='preview' THEN
   DELETE FROM app_private.schedule_previews WHERE actor_id=actor AND expires_at<=now();
   IF (SELECT count(*) FROM app_private.schedule_previews WHERE actor_id=actor)>=60 THEN RAISE EXCEPTION 'RATE_LIMITED'; END IF;
   INSERT INTO app_private.schedule_previews(actor_id,session_id,occurrence_id,payload) VALUES(actor,current_setting('iharu.session_id'),o.id,p) RETURNING * INTO preview;
   RETURN jsonb_build_object('previewToken',preview.id,'expiresAt',preview.expires_at,'affected',affected,'preservedExceptions',exceptions,'protectedOccurrences',protected,'laterVersions',later,'overlaps',overlap_count,'requiresLaterChoice',later>0 AND p->>'laterVersions' IS NULL,'resourceVersion',s.version);
  END IF;
  SELECT * INTO preview FROM app_private.schedule_previews WHERE id=(p->>'previewToken')::uuid FOR UPDATE;
  IF NOT FOUND OR preview.actor_id<>actor OR preview.session_id<>current_setting('iharu.session_id') OR preview.expires_at<=now() OR preview.occurrence_id<>o.id OR preview.payload IS DISTINCT FROM p-'key'-'previewToken' THEN RAISE EXCEPTION 'PREVIEW_EXPIRED'; END IF;
  IF p->>'scope'='ONE' THEN
   INSERT INTO app.occurrence_exceptions(occurrence_id,changes,reason) VALUES(o.id,ch,ch->>'reason') ON CONFLICT(occurrence_id) DO UPDATE SET changes=app.occurrence_exceptions.changes||excluded.changes,reason=coalesce(excluded.reason,app.occurrence_exceptions.reason),updated_at=now();
  ELSE
   IF later>0 AND coalesce(p->>'laterVersions','') NOT IN ('KEEP','REPLACE') THEN RAISE EXCEPTION 'LATER_CHOICE_REQUIRED'; END IF;
   IF p->>'laterVersions'='REPLACE' THEN DELETE FROM app.schedule_series_versions WHERE series_id=sid AND from_date>=effective;
   ELSE DELETE FROM app.schedule_series_versions WHERE series_id=sid AND from_date=effective;IF next_date IS NOT NULL THEN finish:=least(finish,next_date-1); END IF; END IF;
   UPDATE app.schedule_series_versions SET until_date=effective-1 WHERE series_id=sid AND from_date<effective AND until_date>=effective;
   INSERT INTO app.schedule_series_versions(series_id,from_date,until_date,title,place,frequency,weekdays,start_time,end_time,holiday_policy)
   VALUES(sid,effective,finish,coalesce(ch->>'title',v.title),coalesce(ch->>'place',v.place),'WEEKLY',dates,new_start,new_end,coalesce(ch->>'holidayPolicy',v.holiday_policy));
   UPDATE app.schedule_series SET last_date=(SELECT max(until_date) FROM app.schedule_series_versions WHERE series_id=sid) WHERE id=sid;
  END IF;
  DELETE FROM app_private.schedule_previews WHERE id=preview.id;
 ELSIF op IN ('decision','closure.create','closure.remove') THEN
  IF s.version IS DISTINCT FROM (p->>'expectedVersion')::int THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
  IF op='decision' THEN
   IF o.protected_at IS NOT NULL OR o.starts_at<=now() THEN RAISE EXCEPTION 'PAST_RECORD_LOCKED'; END IF;
   IF p->>'decision' NOT IN ('KEEP','SKIP') OR o.status='CANCELLED' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   INSERT INTO app.occurrence_exceptions(occurrence_id,decision) VALUES(o.id,p->>'decision') ON CONFLICT(occurrence_id) DO UPDATE SET decision=excluded.decision,updated_at=now();
  ELSIF op='closure.create' THEN
   lo:=(p->>'from')::date;hi:=(p->>'to')::date;
   IF lo IS NULL OR hi IS NULL OR lo<today OR hi<lo OR hi>s.last_date OR lo<s.first_date THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   INSERT INTO app.schedule_closures(series_id,from_date,until_date,kind,reason) VALUES(sid,lo,hi,p->>'kind',p->>'reason');
  ELSE
   UPDATE app.schedule_closures SET revoked_at=now() WHERE id=(p->>'closureId')::uuid AND series_id=sid AND revoked_at IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  END IF;
 ELSE RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 UPDATE app.schedule_series SET version=version+1 WHERE id=sid;
 PERFORM app_private.expand_schedule(sid);
 SELECT version INTO affected FROM app.schedule_series WHERE id=sid;
 INSERT INTO app_private.schedule_events(child_id,target_id,kind,resource_version) VALUES(cid,sid,'SCHEDULE_CHANGED',affected) ON CONFLICT DO NOTHING;
 PERFORM app_private.record_event('SCHEDULE_'||upper(op),sid);
 SELECT count(*) INTO overlap_count FROM app.occurrences a JOIN app.occurrences b ON b.child_id=a.child_id AND b.series_id<>a.series_id AND b.starts_at<a.ends_at AND b.ends_at>a.starts_at AND b.status NOT IN ('CANCELLED','SKIPPED') WHERE a.series_id=sid AND a.starts_at>now() AND a.status NOT IN ('CANCELLED','SKIPPED');
 result:=jsonb_build_object('id',sid,'resourceVersion',affected,'overlaps',overlap_count,'serverNow',now());
 UPDATE app_private.schedule_idempotency SET response=result WHERE actor_id=actor AND key=key_value;
 RETURN result;
END $$;

CREATE FUNCTION app_private.schedule_maintenance() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE key_value text:='schedule:'||(now() AT TIME ZONE 'Asia/Seoul')::date; j app_private.schedule_jobs%ROWTYPE; sid uuid; n integer:=0;
BEGIN
 IF NOT pg_try_advisory_xact_lock(17090401) THEN RETURN jsonb_build_object('state','BUSY'); END IF;
 INSERT INTO app_private.schedule_jobs(job_key) VALUES(key_value) ON CONFLICT DO NOTHING;
 SELECT * INTO j FROM app_private.schedule_jobs WHERE job_key=key_value FOR UPDATE;
 IF NOT j.done THEN
  FOR sid IN SELECT s.id FROM app.schedule_series s JOIN app.children c ON c.id=s.child_id
   JOIN app.families f ON f.id=c.family_id
   WHERE s.last_date>=(now() AT TIME ZONE 'Asia/Seoul')::date AND c.status='ACTIVE' AND f.status='ACTIVE'
    AND EXISTS(SELECT 1 FROM app.child_consents co WHERE co.child_id=c.id AND co.purpose='general' AND co.revoked_at IS NULL)
    AND (j.cursor_id IS NULL OR s.id>j.cursor_id) ORDER BY s.id LIMIT 50 LOOP
   PERFORM app_private.expand_schedule(sid);j.cursor_id:=sid;n:=n+1;
  END LOOP;
  UPDATE app_private.schedule_jobs SET cursor_id=j.cursor_id,done=n<50,updated_at=now() WHERE job_key=key_value;
 END IF;
 DELETE FROM app_private.schedule_previews WHERE id IN (SELECT id FROM app_private.schedule_previews WHERE expires_at<=now() LIMIT 500);
 DELETE FROM app_private.schedule_idempotency WHERE (actor_id,key) IN (SELECT actor_id,key FROM app_private.schedule_idempotency WHERE expires_at<=now() LIMIT 500);
 DELETE FROM app_private.schedule_jobs WHERE done AND updated_at<now()-interval '7 days';
 DELETE FROM app_private.holiday_sync_runs WHERE run_date<(now() AT TIME ZONE 'Asia/Seoul')::date-7 AND state<>'LEASED';
 RETURN jsonb_build_object('processed',n,'done',j.done OR n<50);
END $$;

CREATE FUNCTION app_private.holiday_claim(y integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE d date:=(now() AT TIME ZONE 'Asia/Seoul')::date; job app_private.holiday_sync_runs%ROWTYPE; token uuid:=gen_random_uuid();
BEGIN
 IF y<extract(year FROM d)::int-1 OR y>extract(year FROM d)::int+1 THEN RAISE EXCEPTION 'INVALID_YEAR'; END IF;
 INSERT INTO app_private.holiday_years(year) VALUES(y) ON CONFLICT DO NOTHING;
 INSERT INTO app_private.holiday_sync_runs(year,run_date,state) VALUES(y,d,'PENDING') ON CONFLICT DO NOTHING;
 SELECT * INTO job FROM app_private.holiday_sync_runs WHERE year=y AND run_date=d FOR UPDATE;
 IF job.state='DONE' OR job.lease_until>now() OR job.retry_after>now() THEN RETURN NULL; END IF;
 UPDATE app_private.holiday_sync_runs SET state='LEASED',lease_token=token,lease_until=now()+interval '2 minutes',attempts=attempts+1 WHERE year=y AND run_date=d;
 RETURN token;
END $$;

CREATE FUNCTION app_private.holiday_finish(y integer,token uuid,items jsonb,source_hash text,failure text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE job app_private.holiday_sync_runs%ROWTYPE; previous app_private.holiday_years%ROWTYPE; item jsonb;
BEGIN
 SELECT * INTO job FROM app_private.holiday_sync_runs WHERE year=y AND lease_token=token AND state='LEASED' FOR UPDATE;
 IF NOT FOUND OR job.lease_until<=now() THEN RAISE EXCEPTION 'STALE_LEASE'; END IF;
 IF failure IS NOT NULL THEN
  UPDATE app_private.holiday_years SET state='FAILED' WHERE year=y;
  UPDATE app_private.holiday_sync_runs SET state='FAILED',error_code='HOLIDAY_FETCH_FAILED',lease_until=NULL,retry_after=now()+interval '1 hour' WHERE year=y AND run_date=job.run_date;
  RETURN;
 END IF;
 IF jsonb_typeof(items)<>'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 1000 OR source_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'INVALID_HOLIDAYS'; END IF;
 FOR item IN SELECT jsonb_array_elements(items) LOOP
  IF extract(year FROM (item->>'date')::date)<>y OR coalesce(length(item->>'name'),0) NOT BETWEEN 1 AND 100 OR jsonb_typeof(item->'isHoliday')<>'boolean' THEN RAISE EXCEPTION 'INVALID_HOLIDAYS'; END IF;
 END LOOP;
 SELECT * INTO previous FROM app_private.holiday_years WHERE year=y FOR UPDATE;
 DELETE FROM app_private.holidays WHERE year=y;
 INSERT INTO app_private.holidays(year,local_date,name,is_holiday) SELECT y,(x->>'date')::date,x->>'name',(x->>'isHoliday')::bool FROM jsonb_array_elements(items) x ON CONFLICT DO NOTHING;
 UPDATE app_private.holiday_years SET state='READY',version=version+CASE WHEN previous.source_hash IS DISTINCT FROM holiday_finish.source_hash THEN 1 ELSE 0 END,source_hash=holiday_finish.source_hash,last_success_at=now() WHERE year=y;
 UPDATE app_private.holiday_sync_runs SET state='DONE',error_code=NULL,lease_until=NULL,retry_after=NULL WHERE year=y AND run_date=job.run_date;
 -- A changed source reopens today's expansion job; individual manual decisions remain intact.
 IF previous.source_hash IS DISTINCT FROM source_hash THEN DELETE FROM app_private.schedule_jobs WHERE job_key='schedule:'||(now() AT TIME ZONE 'Asia/Seoul')::date; END IF;
END $$;

-- Seal new functions before transferring ownership (managed postgres is not superuser).
DO $seal$
DECLARE fn regprocedure; t text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='worker_runtime') THEN CREATE ROLE worker_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
 GRANT USAGE ON SCHEMA app_private TO worker_runtime;
 FOREACH t IN ARRAY ARRAY['check_schedule_version()','holiday_state(integer)','expand_schedule(uuid)','occurrence_dto(app.occurrences)','schedule_command(text,jsonb)','schedule_maintenance()','holiday_claim(integer)','holiday_finish(integer,uuid,jsonb,text,text)'] LOOP
  fn:=('app_private.'||t)::regprocedure;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,app_runtime,worker_runtime',fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO iharu_policy',fn);
  IF t='schedule_command(text,jsonb)' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO app_runtime',fn); END IF;
  IF t IN ('schedule_maintenance()','holiday_claim(integer)','holiday_finish(integer,uuid,jsonb,text,text)') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO worker_runtime',fn); END IF;
  EXECUTE format('ALTER FUNCTION %s OWNER TO iharu_policy',fn);
 END LOOP;
END $seal$;
REVOKE CREATE ON SCHEMA app_private FROM iharu_policy;
REVOKE ALL ON app.schedule_series,app.schedule_series_versions,app.occurrences,app.occurrence_exceptions,app.schedule_closures FROM PUBLIC;
REVOKE ALL ON app_private.holidays,app_private.holiday_years,app_private.holiday_sync_runs,app_private.schedule_jobs,app_private.schedule_previews,app_private.schedule_idempotency,app_private.schedule_events FROM PUBLIC;
