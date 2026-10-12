create or replace function public.remember_event_categories(p_title text, p_description text, p_categories public.event_category[], p_scores jsonb, p_version text, p_model text)
returns integer language plpgsql security definer set search_path = '' set statement_timeout='30s'
as $$
declare
  eligible uuid[];
  changed integer;
begin
  if p_version is distinct from 'fun-v1' or p_model is distinct from 'jev-1.13.0'
    or cardinality(p_categories) not between 1 and 3
    or array_position(p_categories, null) is not null
    or not p_categories <@ array['music','arts','sports','play','market','social','other']::public.event_category[]
    or (cardinality(p_categories) > 1 and 'other' = any(p_categories))
    or (select count(distinct c) from unnest(p_categories) c) <> cardinality(p_categories)
    then raise exception 'Invalid category classification'; end if;
  -- Capture the existing derived labels before replacing the cache. Explicit curator arrays are kept.
  select array_agg(locked.id) into eligible from (
    select e.id from public.events e
    where e.title = p_title and coalesce(e.description, '') = coalesce(p_description, '')
      and e.categories = private.classify_categories(e.title, e.description, e.category)
    for update
  ) locked;
  insert into private.event_category_cache(input_hash,title,description,categories,scores,version,model)
  values(private.category_input_hash(p_title,p_description),p_title,coalesce(p_description,''),p_categories,p_scores,p_version,p_model)
  on conflict(input_hash) do update set categories=excluded.categories, scores=excluded.scores,
    version=excluded.version, model=excluded.model, created_at=now()
  where event_category_cache.title=excluded.title and event_category_cache.description=excluded.description
    and (excluded.categories is not null or event_category_cache.version <> excluded.version
      or (event_category_cache.scores->'resolution'->>'type' is distinct from 'multi-label' and excluded.scores->'resolution'->>'type'='multi-label')
      or (event_category_cache.categories is null and (excluded.scores ? 'resolution' or not event_category_cache.scores ? 'resolution')));

  -- This uses the same trigger as imports, updating categories, primary category and hidden status together.
  update public.events e set category = e.category
  where e.id = any(eligible) and e.title = p_title and coalesce(e.description, '') = coalesce(p_description, '');
  get diagnostics changed = row_count;
  return changed;
end
$$;

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
  -- The first-pass model and taxonomy are unchanged. Revisit exclusive choices and
  -- previously ignored borderline secondary tags once under the independent policy.
  where (c.categories is null and (c.input_hash is null or not c.scores ? 'resolution'))
    or c.scores->'resolution'->>'type'='choice'
    or (not c.scores ? 'resolution' and exists(
      select 1 from jsonb_each(c.scores) a
      where a.key in ('music','arts','sports','activities','fests','parties')
        and (a.value->>'noul')::numeric > .2 and (a.value->>'noul')::numeric < .8))
  order by g.has_future desc, c.created_at asc nulls first, g.first_start desc, g.title, g.description
  limit greatest(1, least(p_limit, 5000))
$$;


-- A poster or source link alone must not suppress description retries.
create or replace function public.get_staged_enrichment(p_run_id uuid,p_external_ids text[])
returns setof jsonb language plpgsql volatile security invoker set search_path='' as $$
declare e private.source_events;
begin
  perform private.require_source_pipeline(p_run_id);
  for e in select * from private.source_events where run_id=p_run_id and external_id=any(p_external_ids)
    and enriched_at>now()-interval '7 days' and enriched->'enrichment'->>'status'='enriched'
    and nullif(btrim(enriched->'data'->>'description'),'') is not null loop
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

notify pgrst, 'reload schema';
