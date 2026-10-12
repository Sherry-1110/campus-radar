-- Capture derived rows before changing the resolver; preserve explicit curator arrays.
create temporary table category_backfill_ids on commit drop as
select e.id from public.events e
where e.categories = private.classify_categories(e.title,e.description,e.category);

-- Empty means unresolved; 'other' means a completed judgment that none fits.
create or replace function private.classify_categories(p_title text,p_description text,p_primary public.event_category)
returns public.event_category[] language sql stable security definer set search_path='' as $$
  select coalesce((select c.categories from private.event_category_cache c
    where c.input_hash=private.category_input_hash(p_title,p_description)
      and c.title=p_title and c.description=coalesce(p_description,'') and c.version='fun-v1'),
    array[]::public.event_category[])
$$;

-- Unknown labels must not hide an event. Explicit internal/staff restrictions still apply.
create or replace function private.is_hidden_event(p_title text,p_source uuid,p_categories public.event_category[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.sources s where s.id=p_source and s.url ~* '(northwestern\.edu|nurecreation\.com)')
    and (private.is_internal_event(p_title,p_source)
      or (cardinality(p_categories)>0 and not p_categories && array['music','arts','sports','play','market','social']::public.event_category[])
      or (lower(coalesce(p_title,'')) ~ '\m(staff|employees?|faculty ?(&|and) ?staff|faculty senate)\M'
        and not coalesce(p_categories && array['music','arts']::public.event_category[],false)))
$$;

create or replace function private.fill_event_category()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.categories:=private.classify_categories(new.title,new.description,new.category);
  new.category:=coalesce(new.categories[1],'other');
  new.is_hidden:=private.is_hidden_event(new.title,new.source_id,new.categories);
  return new;
end $$;

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
  where c.categories is null and (c.input_hash is null or not c.scores ? 'resolution')
  order by c.created_at asc nulls first,
    g.has_future desc, g.first_start desc, g.title, g.description
  limit greatest(1, least(p_limit, 5000))
$$;


-- Reconcile categories, primary category and visibility together for existing events.
update public.events e set category=e.category
from category_backfill_ids b where b.id=e.id
  and (e.categories is distinct from private.classify_categories(e.title,e.description,e.category)
    or e.is_hidden is distinct from private.is_hidden_event(e.title,e.source_id,private.classify_categories(e.title,e.description,e.category)));

notify pgrst, 'reload schema';
