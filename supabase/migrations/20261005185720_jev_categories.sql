-- Persistent Jev judgments reuse identical event text across dates and source runs.
create table private.event_category_cache (
  input_hash text primary key,
  title text not null,
  description text not null,
  categories public.event_category[] check (cardinality(categories) between 1 and 3),
  scores jsonb not null,
  version text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create function private.category_input_hash(p_title text, p_description text)
returns text language sql immutable set search_path = ''
as $$ select md5(jsonb_build_array(p_title, coalesce(p_description, ''))::text) $$;

alter function private.classify_categories(text, text, public.event_category) rename to rule_categories;
create function private.classify_categories(p_title text, p_description text, p_primary public.event_category)
returns public.event_category[] language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select c.categories from private.event_category_cache c
     where c.input_hash = private.category_input_hash(p_title, p_description)
       and c.title = p_title and c.description = coalesce(p_description, '') and c.version = 'fun-v1'),
    private.rule_categories(p_title, p_description, p_primary))
$$;

create function public.pending_event_categories(p_limit integer default 5000, p_version text default 'fun-v1')
returns table(title text, description text) language sql stable security definer set search_path = ''
as $$
  select e.title, coalesce(e.description, '')
  from public.events e
  left join private.event_category_cache c
    on c.input_hash = private.category_input_hash(e.title, e.description)
    and c.title = e.title and c.description = coalesce(e.description, '') and c.version = p_version
  where e.status = 'published' and c.categories is null
  group by e.title, coalesce(e.description, '')
  order by max(c.created_at) asc nulls first,
    bool_or(coalesce(e.end_time, e.start_time) >= now()) desc, min(e.start_time) desc, e.title, coalesce(e.description, '')
  limit greatest(1, least(p_limit, 5000))
$$;

create function public.remember_event_categories(p_title text, p_description text, p_categories public.event_category[], p_scores jsonb, p_version text, p_model text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  eligible uuid[];
  changed integer;
begin
  if p_version <> 'fun-v1' or p_model <> 'jev-1.13.0'
    or cardinality(p_categories) not between 1 and 3
    or array_position(p_categories, null) is not null
    or not p_categories <@ array['music','arts','sports','play','market','social','other']::public.event_category[]
    or (cardinality(p_categories) > 1 and 'other' = any(p_categories))
    or (select count(distinct c) from unnest(p_categories) c) <> cardinality(p_categories)
    then raise exception 'Invalid category classification'; end if;
  -- Capture the existing derived labels before replacing the cache. Explicit curator arrays are kept.
  select array_agg(locked.id) into eligible from (
    select e.id from public.events e
    where p_categories is not null and e.title = p_title and coalesce(e.description, '') = coalesce(p_description, '')
      and e.categories = private.classify_categories(e.title, e.description, e.category)
    for update
  ) locked;
  insert into private.event_category_cache(input_hash,title,description,categories,scores,version,model)
  values(private.category_input_hash(p_title,p_description),p_title,coalesce(p_description,''),p_categories,p_scores,p_version,p_model)
  on conflict(input_hash) do update set categories=excluded.categories, scores=excluded.scores,
    version=excluded.version, model=excluded.model, created_at=now()
  where event_category_cache.title=excluded.title and event_category_cache.description=excluded.description
    and (excluded.categories is not null or event_category_cache.categories is null or event_category_cache.version <> excluded.version);
  if p_categories is null then return 0; end if;
  -- This uses the same trigger as imports, updating categories, primary category and hidden status together.
  update public.events e set category = e.category
  where e.id = any(eligible) and e.title = p_title and coalesce(e.description, '') = coalesce(p_description, '');
  get diagnostics changed = row_count;
  return changed;
end
$$;

revoke all on function public.pending_event_categories(integer,text) from public, anon, authenticated;
revoke all on function public.remember_event_categories(text,text,public.event_category[],jsonb,text,text) from public, anon, authenticated;
grant execute on function public.pending_event_categories(integer,text) to service_role;
grant execute on function public.remember_event_categories(text,text,public.event_category[],jsonb,text,text) to service_role;
