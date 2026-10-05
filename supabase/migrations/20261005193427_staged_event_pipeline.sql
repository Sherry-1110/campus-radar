-- Raw publisher responses are backend-only, partitioned by source, and content-addressed.
create table private.source_pipeline_runs (
  id uuid primary key,
  source_key text not null references public.sources(adapter_key),
  captured_at timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  processor_version text not null,
  stage text not null default 'collecting' check(stage in ('collecting','normalized','enriched','applied')),
  status text not null default 'running' check(status in ('running','succeeded','failed')),
  expected_count integer,
  error_code text
);
create index source_pipeline_runs_source_idx on private.source_pipeline_runs(source_key,started_at desc);
create table private.raw_source_documents (
  source_key text not null,
  body_hash text not null,
  body text not null check(octet_length(body)<=33554432),
  captured_at timestamptz not null default now(),
  primary key(source_key,body_hash)
) partition by list(source_key);
do $$ declare k text; begin
  foreach k in array array['planitpurple','bienen','choose-chicago','chicago-roundups','garage','nusports','cats-on-campus','downtown-evanston','space','do312','music-box','second-city'] loop
    execute format('create table private.%I partition of private.raw_source_documents for values in (%L)', 'raw_'||replace(k,'-','_'),k);
  end loop;
end $$;
create table private.source_run_documents (
  run_id uuid not null references private.source_pipeline_runs on delete cascade,
  scope text not null check(scope in ('feed','original')),
  request_url text not null,
  response_url text not null,
  source_key text not null,
  body_hash text not null,
  primary key(run_id,scope,request_url),
  foreign key(source_key,body_hash) references private.raw_source_documents
);
create index source_run_documents_body_idx on private.source_run_documents(source_key,body_hash);
-- Latest standardized input per upstream identity; canonical event records stay separate.
create table private.source_events (
  source_key text not null,
  external_id text not null,
  run_id uuid not null references private.source_pipeline_runs,
  normalized jsonb not null,
  normalized_hash text not null,
  enriched jsonb,
  enriched_at timestamptz,
  enriched_run_id uuid references private.source_pipeline_runs,
  processor_version text not null,
  stage text not null check(stage in ('normalized','enriched','applied')),
  event_id uuid references public.events on delete set null,
  updated_at timestamptz not null default now(),
  primary key(source_key,external_id)
);
create index source_events_run_idx on private.source_events(run_id);
create index source_events_event_idx on private.source_events(event_id);
revoke all on private.source_pipeline_runs,private.raw_source_documents,private.source_run_documents,private.source_events from public,anon,authenticated;
grant all on private.source_pipeline_runs,private.raw_source_documents,private.source_run_documents,private.source_events to service_role;

create function public.begin_source_pipeline(p_source_name text,p_run_url text,p_captured_at timestamptz,p_version text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r uuid; k text;
begin
  if p_captured_at is null or p_version is null then raise exception 'Missing pipeline version or clock'; end if;
  perform pg_advisory_xact_lock(hashtextextended('campus-radar-ingestion',0));
  select adapter_key into strict k from public.sources where name=p_source_name;
  if exists(select 1 from private.source_pipeline_runs where source_key=k and status='succeeded' and captured_at>p_captured_at) then
    raise exception 'Cannot publish capture older than latest successful run';
  end if;
  r:=public.begin_source_sync(p_source_name,p_run_url);
  -- The ingestion advisory lock also protects superseding interrupted older runs.
  update private.source_pipeline_runs set status='failed',completed_at=now(),error_code='sync_failed'
    where source_key=k and status='running';
  insert into private.source_pipeline_runs(id,source_key,captured_at,processor_version) values(r,k,p_captured_at,p_version);
  return r;
end $$;

create function private.require_source_pipeline(p_run_id uuid)
returns private.source_pipeline_runs language plpgsql security invoker set search_path='' as $$
declare r private.source_pipeline_runs;
begin
  select * into strict r from private.source_pipeline_runs where id=p_run_id;
  if r.status<>'running' or not exists(select 1 from public.source_health h join public.sources s on s.name=h.source_name where h.run_id=p_run_id and s.adapter_key=r.source_key and h.status='running') then
    raise exception 'Stale or completed pipeline run';
  end if;
  return r;
end $$;

create function public.store_source_document(p_run_id uuid,p_scope text,p_request_url text,p_response_url text,p_body text)
returns void language plpgsql security invoker set search_path='' as $$
declare r private.source_pipeline_runs; h text;
begin
  r:=private.require_source_pipeline(p_run_id);
  if p_request_url !~ '^https://' or p_response_url !~ '^https://' or p_body is null then raise exception 'Invalid raw response'; end if;
  h:=encode(sha256(convert_to(p_body,'UTF8')),'hex');
  insert into private.raw_source_documents(source_key,body_hash,body) values(r.source_key,h,p_body) on conflict do nothing;
  insert into private.source_run_documents(run_id,scope,request_url,response_url,source_key,body_hash)
    values(p_run_id,p_scope,p_request_url,p_response_url,r.source_key,h)
    on conflict(run_id,scope,request_url) do update set response_url=excluded.response_url,body_hash=excluded.body_hash;
end $$;

create function public.stage_source_events(p_run_id uuid,p_items jsonb,p_stage text)
returns void language plpgsql security invoker set search_path='' as $$
declare r private.source_pipeline_runs; i jsonb; h text;
begin
  r:=private.require_source_pipeline(p_run_id);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 or p_stage is null or p_stage not in ('normalized','enriched') then raise exception 'Invalid staging batch'; end if;
  for i in select value from jsonb_array_elements(p_items) loop
    if coalesce(i->>'external_id','')='' or jsonb_typeof(i->'data') is distinct from 'object' then raise exception 'Invalid staged event'; end if;
    h:=md5(i::text);
    if p_stage='normalized' then
      if r.stage<>'collecting' then raise exception 'Normalization already completed'; end if;
      insert into private.source_events(source_key,external_id,run_id,normalized,normalized_hash,processor_version,stage)
      values(r.source_key,i->>'external_id',p_run_id,i,h,r.processor_version,'normalized')
      on conflict(source_key,external_id) do update set run_id=excluded.run_id,normalized=excluded.normalized,normalized_hash=excluded.normalized_hash,
        enriched=case when source_events.normalized=excluded.normalized and source_events.processor_version=excluded.processor_version then source_events.enriched end,
        enriched_at=case when source_events.normalized=excluded.normalized and source_events.processor_version=excluded.processor_version then source_events.enriched_at end,
        enriched_run_id=case when source_events.normalized=excluded.normalized and source_events.processor_version=excluded.processor_version then source_events.enriched_run_id end,
        processor_version=excluded.processor_version,stage='normalized',updated_at=now();
    else
      if r.stage<>'normalized' then raise exception 'Complete normalization before enrichment'; end if;
      update private.source_events set enriched=i,
        enriched_at=case when enriched=i and enriched_at>now()-interval '7 days' then enriched_at else now() end,
        enriched_run_id=p_run_id,stage='enriched',updated_at=now()
      where run_id=p_run_id and source_key=r.source_key and external_id=i->>'external_id';
      if not found then raise exception 'Enrichment has no staged input'; end if;
    end if;
  end loop;
end $$;

create function public.complete_source_stage(p_run_id uuid,p_stage text,p_count integer)
returns void language plpgsql security invoker set search_path='' as $$
declare r private.source_pipeline_runs; n integer;
begin
  r:=private.require_source_pipeline(p_run_id);
  if p_count is null or p_count<1 or p_stage not in ('normalized','enriched') then raise exception 'Invalid pipeline completion'; end if;
  if (p_stage='normalized' and r.stage<>'collecting') or (p_stage='enriched' and r.stage<>'normalized') then raise exception 'Pipeline stage out of order'; end if;
  select count(*) into n from private.source_events where run_id=p_run_id and stage=p_stage;
  if n<>p_count or (p_stage='enriched' and r.expected_count<>p_count) then raise exception 'Incomplete staged snapshot'; end if;
  update private.source_pipeline_runs set stage=p_stage,expected_count=p_count where id=p_run_id;
end $$;

create function public.publish_staged_events(p_run_id uuid,p_external_ids text[])
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r private.source_pipeline_runs; items jsonb; result jsonb; source_name text;
begin
  r:=private.require_source_pipeline(p_run_id);
  if r.stage<>'enriched' or cardinality(p_external_ids) not between 1 and 100 then raise exception 'Snapshot not ready to publish'; end if;
  select jsonb_agg(enriched order by external_id) into items from private.source_events where run_id=p_run_id and external_id=any(p_external_ids) and enriched is not null;
  if coalesce(jsonb_array_length(items),0)<>cardinality(p_external_ids) then raise exception 'Incomplete publish batch'; end if;
  select name into strict source_name from public.sources where adapter_key=r.source_key;
  result:=public.sync_source_events(source_name,items,p_run_id);
  update private.source_events se set stage='applied',event_id=i.event_id,updated_at=now()
  from private.ingestion_items i join public.sources s on s.id=i.source_id
  where se.run_id=p_run_id and se.external_id=any(p_external_ids) and i.external_id=se.external_id and s.adapter_key=se.source_key;
  return result;
end $$;

create function public.finish_source_pipeline(p_run_id uuid,p_status text,p_summary jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare r private.source_pipeline_runs;
begin
  r:=private.require_source_pipeline(p_run_id);
  if p_status='succeeded' and (r.stage<>'enriched' or (select count(*) from private.source_events where run_id=p_run_id and stage='applied')<>r.expected_count) then raise exception 'Pipeline not fully published'; end if;
  perform public.finish_source_sync(p_run_id,p_status,p_summary);
  update private.source_pipeline_runs set status=p_status,stage=case when p_status='succeeded' then 'applied' else stage end,completed_at=now(),error_code=p_summary->>'error_code' where id=p_run_id;
  -- Retain three recent raw runs per source, including failures. Current normalized rows keep their run metadata.
  delete from private.source_run_documents where run_id in (
    select id from private.source_pipeline_runs where source_key=r.source_key and status<>'running' order by started_at desc offset 3);
  delete from private.raw_source_documents d where d.source_key=r.source_key and not exists(
    select 1 from private.source_run_documents m where m.source_key=d.source_key and m.body_hash=d.body_hash);
end $$;

create function public.get_source_pipeline(p_run_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('source_key',r.source_key,'source_name',s.name,'captured_at',r.captured_at,'stage',r.stage,'status',r.status)
  from private.source_pipeline_runs r join public.sources s on s.adapter_key=r.source_key where r.id=p_run_id
$$;
create function public.get_source_documents(p_run_id uuid)
returns table(scope text,request_url text,response_url text,body text) language sql stable security invoker set search_path='' as $$
  select m.scope,m.request_url,m.response_url,d.body from private.source_run_documents m
  join private.raw_source_documents d using(source_key,body_hash) where m.run_id=p_run_id order by m.scope,m.request_url
$$;

revoke all on function private.require_source_pipeline(uuid),public.begin_source_pipeline(text,text,timestamptz,text),public.store_source_document(uuid,text,text,text,text),public.stage_source_events(uuid,jsonb,text),public.complete_source_stage(uuid,text,integer),public.publish_staged_events(uuid,text[]),public.finish_source_pipeline(uuid,text,jsonb),public.get_source_pipeline(uuid),public.get_source_documents(uuid) from public,anon,authenticated;
grant execute on function private.require_source_pipeline(uuid),public.begin_source_pipeline(text,text,timestamptz,text),public.store_source_document(uuid,text,text,text,text),public.stage_source_events(uuid,jsonb,text),public.complete_source_stage(uuid,text,integer),public.publish_staged_events(uuid,text[]),public.finish_source_pipeline(uuid,text,jsonb),public.get_source_pipeline(uuid),public.get_source_documents(uuid) to service_role;

-- A successful unchanged organizer result is reused for a week; unavailable results retry next run.
create function public.get_staged_enrichment(p_run_id uuid,p_external_ids text[])
returns setof jsonb language plpgsql volatile security invoker set search_path='' as $$
declare e private.source_events;
begin
  perform private.require_source_pipeline(p_run_id);
  for e in select * from private.source_events where run_id=p_run_id and external_id=any(p_external_ids)
    and enriched_at>now()-interval '7 days' and enriched->'enrichment'->>'status'='enriched' loop
    -- An absent event can outlive raw retention; never reuse an enrichment whose evidence can no longer replay.
    if exists(select 1 from jsonb_array_elements_text(coalesce(e.enriched->'enrichment'->'chain','[]'::jsonb)) c(url)
      where not exists(select 1 from private.source_run_documents d where d.run_id=e.enriched_run_id
        and d.source_key=e.source_key and d.scope='original' and c.url in (d.request_url,d.response_url))) then
      continue;
    end if;
    -- Copy references, not bodies, so retained runs can replay cached organizer evidence after its first run expires.
    insert into private.source_run_documents(run_id,scope,request_url,response_url,source_key,body_hash)
      select p_run_id,d.scope,d.request_url,d.response_url,d.source_key,d.body_hash
      from private.source_run_documents d where d.run_id=e.enriched_run_id and d.source_key=e.source_key and d.scope='original'
        and (d.request_url=e.enriched->>'related_url' or d.response_url=e.enriched->>'related_url'
          or (e.enriched->'enrichment'->'chain') ? d.request_url or (e.enriched->'enrichment'->'chain') ? d.response_url)
      on conflict(run_id,scope,request_url) do nothing;
    update private.source_events set enriched_run_id=p_run_id where source_key=e.source_key and external_id=e.external_id;
    return next e.enriched;
  end loop;
end $$;
revoke all on function public.get_staged_enrichment(uuid,text[]) from public,anon,authenticated;
grant execute on function public.get_staged_enrichment(uuid,text[]) to service_role;

insert into public.sources(name,type,url,adapter_key,authority,is_active) values
  ('Cats on Campus','calendar_scrape','https://catsoncampus.northwestern.edu/events','cats-on-campus',20,true),
  ('Downtown Evanston','calendar_scrape','https://downtownevanston.org/upcoming-events','downtown-evanston',10,true),
  ('SPACE','calendar_scrape','https://evanstonspace.com/all-shows','space',30,true),
  ('Do312','calendar_scrape','https://do312.com/','do312',5,true),
  ('The Second City','calendar_scrape','https://www.secondcity.com/shows/chicago','second-city',30,true),
  ('Music Box Theatre','calendar_scrape','https://musicboxtheatre.com/calendar','music-box',30,false)
on conflict(name) do update set adapter_key=excluded.adapter_key,url=excluded.url,authority=excluded.authority,is_active=excluded.is_active;
