-- Dates remain first-class events. A series only changes discovery grouping.
create table public.event_series (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique
);
alter table public.event_series enable row level security;
grant select on public.event_series to anon, authenticated;
grant all on public.event_series to service_role;
alter table public.events add column series_id uuid references public.event_series(id);
create index events_series_start_idx on public.events(series_id,start_time,id);
create policy series_published on public.event_series for select to anon, authenticated
using (exists(select 1 from public.events e where e.series_id=event_series.id and e.status='published'));

create function private.event_series_key(e public.events) returns text
language sql immutable set search_path='' as $$
  select case when e.source_id is null or e.created_by is not null or nullif(trim(e.location),'') is null then null
  else md5(jsonb_build_array(e.school_id,e.source_id,
    lower(regexp_replace(trim(e.title),'\s+',' ','g')),
    lower(regexp_replace(trim(e.location),'\s+',' ','g')), evidence)::text) end
  from (select case
    when e.source_url ~ '^https://www\.choosechicago\.com/event/[^/?#]+(/\d{4}-\d{2}-\d{2})?/?$'
      then 'url:' || regexp_replace(regexp_replace(e.source_url,'/\d{4}-\d{2}-\d{2}/?$',''), '/$','')
    when e.source_url ~ '^https://(www\.music\.northwestern\.edu/events/|www\.addevent\.com/event/)[^/?#]+/?$'
      then 'url:' || regexp_replace(e.source_url,'/$','')
    -- ponytail: exact content within a calendar year misses edited descriptions and New Year series;
    -- use explicit upstream series IDs when adapters expose them. Never match a title alone.
    when length(trim(e.description)) >= 120 then 'content:' ||
      extract(year from e.start_time at time zone 'America/Chicago')::text || ':' ||
      lower(regexp_replace(trim(e.description),'\s+',' ','g'))
    else null end as evidence) s
  where evidence is not null;
$$;
revoke all on function private.event_series_key(public.events) from public, anon, authenticated;

create function private.assign_event_series() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text := private.event_series_key(new);
begin
  if k is null then new.series_id := null;
  else
    insert into public.event_series(identity_key) values(k) on conflict(identity_key) do nothing;
    select id into new.series_id from public.event_series where identity_key=k;
  end if;
  return new;
end $$;
revoke all on function private.assign_event_series() from public, anon, authenticated;
create trigger events_assign_series before insert or update of school_id,source_id,created_by,title,description,location,source_url,start_time,series_id
on public.events for each row execute function private.assign_event_series();
-- Additive backfill: no dates, IDs, saved references or source provenance are removed.
update public.events set series_id=null where private.event_series_key(events) is not null;

-- All filters apply to occurrences FIRST; then choose a representative, then PostgREST
-- counts/paginates the returned rows. Invoker rights preserve the caller's RLS policies.
create function public.browse_events(
  p_ranges jsonb default null,
  p_categories public.event_category[] default null,
  p_areas public.event_area[] default null,
  p_regions public.event_region[] default null,
  p_free boolean default false,
  p_term text default '',
  p_bounds jsonb default null,
  p_located boolean default false,
  p_ids uuid[] default null,
  p_group boolean default true
) returns table(event jsonb)
language sql stable security invoker set search_path='' as $$
  with matching as (
    select e.*, case when c.event_id is not null then jsonb_build_object('latitude',c.latitude,'longitude',c.longitude) end as event_coordinates,
      case when p_group then coalesce(e.series_id,e.id) else e.id end as group_id
    from public.events e left join public.event_coordinates c on c.event_id=e.id
      and c.expires_at>now() and c.coordinate_location=e.location
    where e.status='published'
      and e.start_time >= date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago'
      and (p_ranges is null or exists(select 1 from jsonb_array_elements(p_ranges) r
        where e.start_time >= (r->>'from')::timestamptz and (r->>'to' is null or e.start_time < (r->>'to')::timestamptz)))
      and (p_categories is null or e.category=any(p_categories))
      and (p_areas is null or e.area=any(p_areas))
      and (p_regions is null or e.region=any(p_regions))
      and (not p_free or e.is_free)
      and (p_term='' or e.title ilike '%'||replace(replace(replace(p_term,'\','\\'),'%','\%'),'_','\_')||'%'
        or e.search @@ websearch_to_tsquery('english',p_term))
      and (p_ids is null or e.id=any(p_ids))
      and (not p_located or c.event_id is not null)
      and (p_bounds is null or (c.latitude between (p_bounds->>'south')::float8 and (p_bounds->>'north')::float8
        and c.longitude between (p_bounds->>'west')::float8 and (p_bounds->>'east')::float8))
  ), ranked as (
    select m.*, row_number() over(partition by group_id order by is_cancelled,start_time,id) as position,
      count(*) over(partition by group_id) as matching_dates from matching m
  )
  select to_jsonb(r) - array['group_id','position','description','search','dedupe_key','created_by','tags']
  from ranked r where position=1 order by start_time,id;
$$;
revoke all on function public.browse_events(jsonb,public.event_category[],public.event_area[],public.event_region[],boolean,text,jsonb,boolean,uuid[],boolean) from public;
grant execute on function public.browse_events(jsonb,public.event_category[],public.event_area[],public.event_region[],boolean,text,jsonb,boolean,uuid[],boolean) to anon,authenticated,service_role;
