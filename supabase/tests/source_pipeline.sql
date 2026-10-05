begin;
-- Test-only helper: the assertion is outside the caught exception block.
create function pg_temp.expect_pipeline_error(statement text, pattern text) returns void
language plpgsql as $$
declare message text;
begin
  begin execute statement;
  exception when others then get stacked diagnostics message = message_text;
  end;
  if message is null or message !~* pattern then
    raise exception 'Expected error matching %, got % from %', pattern, message, statement;
  end if;
end $$;

set local role service_role;
do $$
declare
  run uuid; again uuid; other uuid; stale uuid; latest uuid;
  canonical_id uuid; baseline jsonb; stats jsonb; ids uuid[] := '{}'; j integer;
  candidate jsonb := '{"external_id":"pipeline-test-1","related_url":null,"data":{"title":"Pipeline regression concert","description":"Publisher program","cover_image_url":null,"start_time":"2099-10-05T20:00:00Z","end_time":null,"location":"Pipeline test venue","location_url":null,"is_free":false,"fee_text":null,"category":"music","is_cancelled":false,"is_all_day":false,"source_url":"https://pipeline-test.example/concert"}}';
  changed jsonb; enriched_input jsonb; cached uuid;
begin
  run := public.begin_source_pipeline('The Garage',null,'2099-10-01Z','test-v1');
  perform set_config('test.pipeline_run_id',run::text,true);
  if public.get_source_pipeline(run)->>'source_key' <> 'garage' then raise exception 'Pipeline metadata lost source'; end if;
  perform public.store_source_document(run,'feed','https://pipeline-test.example/feed','https://pipeline-test.example/feed','shared publisher body');
  perform public.store_source_document(run,'original','https://pipeline-test.example/detail','https://pipeline-test.example/detail-final','shared publisher body');
  if (select count(*) from private.raw_source_documents where source_key='garage')<>1 then raise exception 'Identical bodies must deduplicate within source'; end if;
  if (select count(*) from public.get_source_documents(run))<>2 then raise exception 'Replay must retain both request mappings'; end if;
  if not exists(select 1 from public.get_source_documents(run) where scope='original' and response_url='https://pipeline-test.example/detail-final' and body='shared publisher body') then raise exception 'Replay lost response URL or body'; end if;
  if not exists(select 1 from private.raw_source_documents where source_key='garage' and tableoid='private.raw_garage'::regclass) then raise exception 'Garage raw response routed to wrong partition'; end if;
  other := public.begin_source_pipeline('Bienen School of Music',null,'2099-10-01Z','test-v1');
  perform public.store_source_document(other,'feed','https://pipeline-test.example/feed','https://pipeline-test.example/feed','shared publisher body');
  if (select count(*) from private.raw_source_documents where body='shared publisher body')<>2 then raise exception 'Content dedup must remain isolated by source'; end if;
  if not exists(select 1 from private.raw_source_documents where source_key='bienen' and tableoid='private.raw_bienen'::regclass) then raise exception 'Bienen raw response routed to wrong partition'; end if;
  perform public.finish_source_pipeline(other,'failed','{"error_code":"fetch_failed"}');

  perform pg_temp.expect_pipeline_error(format('select public.store_source_document(%L,''feed'',''http://invalid.example/'',''https://pipeline-test.example/'',''bad'')',run),'Invalid raw');
  perform pg_temp.expect_pipeline_error(format('select public.stage_source_events(%L,''[]'',''normalized'')',run),'Invalid staging');
  perform pg_temp.expect_pipeline_error(format('select public.stage_source_events(%L,''[{"external_id":"bad"}]'',''normalized'')',run),'Invalid staged');
  perform pg_temp.expect_pipeline_error(format('select public.stage_source_events(%L,%L::jsonb,''enriched'')',run,jsonb_build_array(candidate)),'Complete normalization');
  perform pg_temp.expect_pipeline_error(format('select public.complete_source_stage(%L,''enriched'',1)',run),'out of order');
  perform pg_temp.expect_pipeline_error(format('select public.publish_staged_events(%L,array[''pipeline-test-1''])',run),'not ready');
  perform public.stage_source_events(run,jsonb_build_array(candidate),'normalized');
  perform pg_temp.expect_pipeline_error(format('select public.complete_source_stage(%L,''normalized'',2)',run),'Incomplete');
  perform public.complete_source_stage(run,'normalized',1);
  perform pg_temp.expect_pipeline_error(format('select public.stage_source_events(%L,%L::jsonb,null)',run,jsonb_build_array(candidate)),'Invalid staging');
  perform pg_temp.expect_pipeline_error(format('select public.stage_source_events(%L,%L::jsonb,''normalized'')',run,jsonb_build_array(candidate)),'already completed');
  perform pg_temp.expect_pipeline_error(format('select public.complete_source_stage(%L,''enriched'',1)',run),'Incomplete');
  perform pg_temp.expect_pipeline_error(format('select public.stage_source_events(%L,%L::jsonb,''enriched'')',run,jsonb_build_array(jsonb_set(candidate,'{external_id}','"missing"'))),'no staged input');
  perform public.stage_source_events(run,jsonb_build_array(candidate),'enriched');
  perform public.complete_source_stage(run,'enriched',1);
  perform pg_temp.expect_pipeline_error(format('select public.publish_staged_events(%L,array[''missing''])',run),'Incomplete publish');
  perform pg_temp.expect_pipeline_error(format('select public.finish_source_pipeline(%L,''succeeded'',''{}'')',run),'not fully published');
  stats := public.publish_staged_events(run,array['pipeline-test-1']);
  if (stats->>'inserted')::int<>1 then raise exception 'First staged publish must create one canonical event: %',stats; end if;
  select se.event_id into canonical_id from private.source_events se where source_key='garage' and external_id='pipeline-test-1';
  if canonical_id is null then raise exception 'Staged event did not link its canonical ID'; end if;
  select to_jsonb(e) into baseline from public.events e where id=canonical_id;
  stats := public.publish_staged_events(run,array['pipeline-test-1']);
  if (stats->>'unchanged')::int<>1 or (select to_jsonb(e) from public.events e where id=canonical_id)<>baseline then raise exception 'Repeated publication must be idempotent'; end if;
  perform public.finish_source_pipeline(run,'succeeded','{"candidates":1,"inserted":1}');
  if public.get_source_pipeline(run)->>'stage'<>'applied' or public.get_source_pipeline(run)->>'status'<>'succeeded' then raise exception 'Successful pipeline lifecycle not recorded'; end if;
  perform pg_temp.expect_pipeline_error(format('select public.publish_staged_events(%L,array[''pipeline-test-1''])',run),'Stale or completed');

  update public.events set description='Curator program',status='rejected' where id=canonical_id;
  again := public.begin_source_pipeline('The Garage',null,'2099-10-02Z','test-v1');
  perform public.store_source_document(again,'feed','https://pipeline-test.example/feed','https://pipeline-test.example/feed','shared publisher body');
  if (select count(*) from private.raw_source_documents where source_key='garage')<>1 then raise exception 'Unchanged raw body must deduplicate across runs'; end if;
  changed := jsonb_set(jsonb_set(candidate,'{data,description}','"New publisher program"'),'{data,start_time}','"2099-10-06T20:00:00Z"');
  perform public.stage_source_events(again,jsonb_build_array(changed),'normalized');
  if exists(select 1 from private.source_events where run_id=again and enriched is not null) then raise exception 'Changed normalized input must invalidate cached enrichment'; end if;
  perform public.complete_source_stage(again,'normalized',1);
  perform public.store_source_document(again,'original','https://pipeline-test.example/organizer','https://pipeline-test.example/organizer-final','organizer evidence');
  perform public.store_source_document(again,'original','https://pipeline-test.example/details','https://pipeline-test.example/details','deeper evidence');
  perform public.store_source_document(again,'original','https://pipeline-test.example/unrelated','https://pipeline-test.example/unrelated','unrelated evidence');
  enriched_input := changed || '{"enrichment":{"status":"enriched","fields":[],"base":{},"chain":["https://pipeline-test.example/organizer-final","https://pipeline-test.example/details"]}}'::jsonb;
  perform public.stage_source_events(again,jsonb_build_array(enriched_input),'enriched');
  perform public.complete_source_stage(again,'enriched',1);
  stats := public.publish_staged_events(again,array['pipeline-test-1']);
  if (stats->>'updated')::int<>1 or (stats->>'conflicts')::int<>1 then raise exception 'Curator conflict not reported: %',stats; end if;
  if not exists(select 1 from public.events e where e.id=canonical_id and description='Curator program' and status='rejected' and start_time='2099-10-06T20:00:00Z') then raise exception 'Publish must preserve curator fields and canonical identity while updating schedule'; end if;
  perform public.finish_source_pipeline(again,'succeeded','{"candidates":1,"updated":1,"conflicts":1}');

  perform pg_temp.expect_pipeline_error('select public.begin_source_pipeline(''The Garage'',null,''2099-10-01Z'',''test-v2'')','Cannot publish capture older than latest successful run');
  if (select run_id from public.source_health where source_name='The Garage') is distinct from again then raise exception 'Rejected older replay must not replace current source health'; end if;
  if public.get_source_pipeline(again)->>'status' is distinct from 'succeeded' then raise exception 'Rejected older replay changed successful pipeline status'; end if;
  update private.source_events set enriched_at=now()-interval '6 days' where run_id=again;
  cached := public.begin_source_pipeline('The Garage',null,'2099-10-03Z','test-v1');
  perform public.stage_source_events(cached,jsonb_build_array(changed),'normalized');
  if (select count(*) from public.get_staged_enrichment(cached,array['pipeline-test-1']))<>1 then raise exception 'Unchanged input/version must reuse successful enrichment'; end if;
  if (select count(*) from public.get_source_documents(cached) where scope='original')<>2 then raise exception 'Cached run must retain only its supporting original pages, including redirect evidence'; end if;
  perform public.complete_source_stage(cached,'normalized',1);
  perform public.stage_source_events(cached,jsonb_build_array(enriched_input),'enriched');
  if (select enriched_at from private.source_events where run_id=cached) <> now()-interval '6 days' then raise exception 'Cache reuse must preserve original freshness timestamp'; end if;
  update private.source_events set enriched_at=now()-interval '8 days' where run_id=cached;
  if exists(select 1 from public.get_staged_enrichment(cached,array['pipeline-test-1'])) then raise exception 'Expired enrichment must retry'; end if;
  perform public.stage_source_events(cached,jsonb_build_array(enriched_input),'enriched');
  if (select enriched_at from private.source_events where run_id=cached) <> now() then raise exception 'Freshly fetched expired result must restart cache lifetime'; end if;
  update private.source_events set enriched=jsonb_set(enriched,'{enrichment,status}','"unavailable"') where run_id=cached;
  if exists(select 1 from public.get_staged_enrichment(cached,array['pipeline-test-1'])) then raise exception 'Unavailable enrichment must retry'; end if;
  update private.source_events set enriched=enriched_input where run_id=cached;
  perform public.finish_source_pipeline(cached,'failed','{"error_code":"sync_failed"}');
  for j in 1..3 loop
    cached := public.begin_source_pipeline('The Garage',null,'2099-10-03Z','test-v1');
    update private.source_pipeline_runs set started_at='2099-10-03Z'::timestamptz+j*interval '1 minute' where id=cached;
    perform public.stage_source_events(cached,jsonb_build_array(changed),'normalized');
    if (select count(*) from public.get_staged_enrichment(cached,array['pipeline-test-1']))<>1 then raise exception 'Chained cache reuse lost enriched candidate'; end if;
    perform public.finish_source_pipeline(cached,'failed','{"error_code":"sync_failed"}');
  end loop;
  if exists(select 1 from public.get_source_documents(again)) then raise exception 'Old enrichment run should be pruned after three newer runs'; end if;
  if (select count(*) from public.get_source_documents(cached) where body in ('organizer evidence','deeper evidence'))<>2 then raise exception 'Cached replay lost evidence when its original run was pruned'; end if;
  if exists(select 1 from public.get_source_documents(cached) where body='unrelated evidence') then raise exception 'Cache carry-forward retained unrelated raw pages'; end if;
  -- An event can disappear long enough for its last evidence manifest to be pruned, then return unchanged.
  delete from private.source_run_documents where run_id=cached and scope='original';
  cached := public.begin_source_pipeline('The Garage',null,'2099-10-03Z','test-v1');
  perform public.stage_source_events(cached,jsonb_build_array(changed),'normalized');
  if exists(select 1 from public.get_staged_enrichment(cached,array['pipeline-test-1'])) then raise exception 'Cache without retained organizer evidence must refetch instead of creating an incomplete replay'; end if;
  perform public.finish_source_pipeline(cached,'failed','{"error_code":"sync_failed"}');
  cached := public.begin_source_pipeline('The Garage',null,'2099-10-03Z','test-v2');
  perform public.stage_source_events(cached,jsonb_build_array(changed),'normalized');
  if exists(select 1 from public.get_staged_enrichment(cached,array['pipeline-test-1'])) then raise exception 'Processor version changes must invalidate cache'; end if;
  perform public.finish_source_pipeline(cached,'failed','{"error_code":"sync_failed"}');

  stale := public.begin_source_pipeline('The Garage',null,'2099-10-03Z','test-v1');
  latest := public.begin_source_pipeline('The Garage',null,'2099-10-04Z','test-v1');
  perform pg_temp.expect_pipeline_error(format('select public.store_source_document(%L,''feed'',''https://pipeline-test.example/'',''https://pipeline-test.example/'',''stale'')',stale),'Stale');
  perform pg_temp.expect_pipeline_error(format('select public.stage_source_events(%L,%L::jsonb,''normalized'')',stale,jsonb_build_array(changed)),'Stale');
  perform pg_temp.expect_pipeline_error(format('select public.finish_source_pipeline(%L,''failed'',''{}'')',stale),'Stale');
  perform public.finish_source_pipeline(latest,'failed','{"error_code":"sync_failed"}');

  -- Isolate retention from canonical rows; timestamps are explicit because now() is fixed inside this transaction.
  for j in 1..5 loop
    latest := public.begin_source_pipeline('PlanItPurple',null,'2099-10-01Z','test-v1');
    ids := array_append(ids,latest);
    update private.source_pipeline_runs set started_at='2099-10-01Z'::timestamptz+j*interval '1 minute' where id=latest;
    perform public.store_source_document(latest,'feed','https://pipeline-test.example/retention','https://pipeline-test.example/retention','retention body '||j);
    perform public.finish_source_pipeline(latest,'failed','{"error_code":"fetch_failed"}');
  end loop;
  if (select count(*) from private.source_run_documents where source_key='planitpurple')<>3 then raise exception 'Retention must keep exactly the latest three raw runs'; end if;
  if exists(select 1 from public.get_source_documents(ids[1])) or exists(select 1 from public.get_source_documents(ids[2])) then raise exception 'Old raw runs were not pruned'; end if;
  if not exists(select 1 from public.get_source_documents(ids[3])) or not exists(select 1 from public.get_source_documents(ids[5])) then raise exception 'Retention pruned recent raw runs'; end if;
  if (select count(*) from private.raw_source_documents where source_key='planitpurple')<>3 then raise exception 'Unreferenced raw bodies must be reclaimed'; end if;
  if not exists(select 1 from public.get_source_documents(other)) then raise exception 'Retention crossed source boundary'; end if;
  if not exists(select 1 from private.source_events se where se.event_id=canonical_id and source_key='garage') then raise exception 'Raw retention must preserve standardized/canonical links'; end if;
  stale := public.begin_source_pipeline('Choose Chicago',null,'2099-10-01Z','test-v1');
  perform public.store_source_document(stale,'feed','https://pipeline-test.example/abandoned','https://pipeline-test.example/abandoned','abandoned body');
  for j in 1..3 loop
    latest := public.begin_source_pipeline('Choose Chicago',null,'2099-10-01Z','test-v1');
    update private.source_pipeline_runs set started_at='2099-10-01Z'::timestamptz+j*interval '1 minute' where id=latest;
    perform public.store_source_document(latest,'feed','https://pipeline-test.example/current','https://pipeline-test.example/current','current body '||j);
    perform public.finish_source_pipeline(latest,'failed','{"error_code":"fetch_failed"}');
  end loop;
  if public.get_source_pipeline(stale)->>'status' is distinct from 'failed' then raise exception 'Superseded interrupted run must become failed'; end if;
  if exists(select 1 from public.get_source_documents(stale)) then raise exception 'Interrupted run raw documents escaped retention'; end if;

end $$;

reset role;
-- Every public entry point is tested through the denied roles, not only its ACL metadata.
do $$
declare role_name text; statement text; run uuid := current_setting('test.pipeline_run_id')::uuid;
begin
  foreach role_name in array array['anon','authenticated'] loop
    execute format('set local role %I',role_name);
    foreach statement in array array[
      format('select public.begin_source_pipeline(''The Garage'',null,now(),''test-v1'')'),
      format('select public.store_source_document(%L,''feed'',''https://example.com'',''https://example.com'',''body'')',run),
      format('select public.stage_source_events(%L,''[]'',''normalized'')',run),
      format('select public.complete_source_stage(%L,''normalized'',1)',run),
      format('select public.publish_staged_events(%L,array[''pipeline-test-1''])',run),
      format('select public.finish_source_pipeline(%L,''failed'',''{}'')',run),
      format('select public.get_source_pipeline(%L)',run),
      format('select * from public.get_source_documents(%L)',run),
      format('select * from public.get_staged_enrichment(%L,array[''pipeline-test-1''])',run),
      'select * from private.source_events', 'select * from private.source_pipeline_runs',
      'select * from private.raw_source_documents', 'select * from private.raw_garage',
      'select * from private.source_run_documents'
    ] loop
      perform pg_temp.expect_pipeline_error(statement,'permission denied');
    end loop;
    reset role;
  end loop;
end $$;
rollback;
