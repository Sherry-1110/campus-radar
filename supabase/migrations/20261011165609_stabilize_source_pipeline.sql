-- Keep bounded ingestion operations independent of raw-response maintenance.
create or replace function public.store_source_document(p_run_id uuid,p_scope text,p_request_url text,p_response_url text,p_body text)
returns void language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
declare r private.source_pipeline_runs; h text;
begin
  r:=private.require_source_pipeline(p_run_id);
  if p_request_url !~ '^https://' or p_response_url !~ '^https://' or p_body is null then raise exception 'Invalid raw response'; end if;
  h:=encode(sha256(convert_to(p_body,'UTF8')),'hex');
  insert into private.raw_source_documents(source_key,body_hash,body) select r.source_key,h,p_body
    where not exists(select 1 from private.raw_source_documents where source_key=r.source_key and body_hash=h)
    on conflict do nothing;
  insert into private.source_run_documents(run_id,scope,request_url,response_url,source_key,body_hash)
    values(p_run_id,p_scope,p_request_url,p_response_url,r.source_key,h)
    on conflict(run_id,scope,request_url) do update set response_url=excluded.response_url,body_hash=excluded.body_hash;
end $$;

create or replace function public.finish_source_pipeline(p_run_id uuid,p_status text,p_summary jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare r private.source_pipeline_runs;
begin
  r:=private.require_source_pipeline(p_run_id);
  if p_status='succeeded' and (r.stage<>'enriched' or (select count(*) from private.source_events where run_id=p_run_id and stage='applied')<>r.expected_count) then raise exception 'Pipeline not fully published'; end if;
  perform public.finish_source_sync(p_run_id,p_status,p_summary);
  update private.source_pipeline_runs set status=p_status,stage=case when p_status='succeeded' then 'applied' else stage end,completed_at=now(),error_code=p_summary->>'error_code' where id=p_run_id;
end $$;

-- Maintenance commits independently; its failure cannot roll back source health.
create function public.prune_source_documents(p_source_key text,p_limit integer default 100)
returns integer language plpgsql security invoker set search_path='' set statement_timeout='30s' as $$
declare removed integer; bodies integer;
begin
  if p_limit is null or p_limit not between 1 and 500 or not exists(select 1 from public.sources where adapter_key=p_source_key) then
    raise exception 'Invalid cleanup source or batch size';
  end if;
  delete from private.source_run_documents d where (d.run_id,d.scope,d.request_url) in (
    select m.run_id,m.scope,m.request_url from private.source_run_documents m
    where m.source_key=p_source_key and m.run_id in (
      select id from private.source_pipeline_runs where source_key=p_source_key and status<>'running'
      order by started_at desc,id desc offset 3)
    order by m.run_id,m.scope,m.request_url limit p_limit);
  get diagnostics removed=row_count;
  delete from private.raw_source_documents d where d.source_key=p_source_key and d.body_hash in (
    select r.body_hash from private.raw_source_documents r where r.source_key=p_source_key and not exists(
      select 1 from private.source_run_documents m where m.source_key=r.source_key and m.body_hash=r.body_hash)
    order by r.body_hash limit p_limit);
  get diagnostics bodies=row_count;
  return removed+bodies;
end $$;
revoke all on function public.prune_source_documents(text,integer) from public,anon,authenticated;
grant execute on function public.prune_source_documents(text,integer) to service_role;

-- Backend RPCs handle bounded imports, unlike short interactive requests.
-- PostgREST honors function-level settings; do not change public/client role limits.
alter function public.stage_source_events(uuid,jsonb,text) set statement_timeout='30s';
alter function public.complete_source_stage(uuid,text,integer) set statement_timeout='30s';
alter function public.finish_source_pipeline(uuid,text,jsonb) set statement_timeout='30s';
alter function public.get_staged_enrichment(uuid,text[]) set statement_timeout='30s';
alter function public.remember_event_poster(text,text,text) set statement_timeout='30s';
alter function public.remember_event_categories(text,text,public.event_category[],jsonb,text,text) set statement_timeout='30s';

-- Group recurring event text before cache hashing: one hash per exact text,
-- retaining every published event in the future/earliest-start aggregates.
create or replace function public.pending_event_categories(p_limit integer default 5000, p_version text default 'fun-v1')
returns table(title text, description text) language sql stable security definer set search_path = ''
set statement_timeout = '30s'
as $$
  with grouped as materialized (
    select e.title, coalesce(e.description, '') as description,
      bool_or(coalesce(e.end_time, e.start_time) >= now()) as has_future,
      min(e.start_time) as first_start
    from public.events e
    where e.status = 'published'
    group by e.title, coalesce(e.description, '')
  )
  select g.title, g.description
  from grouped g
  left join private.event_category_cache c
    on c.input_hash = private.category_input_hash(g.title, g.description)
    and c.title = g.title and c.description = g.description and c.version = p_version
  where c.categories is null
  order by c.created_at asc nulls first,
    g.has_future desc, g.first_start desc, g.title, g.description
  limit greatest(1, least(p_limit, 5000))
$$;

notify pgrst, 'reload schema';
