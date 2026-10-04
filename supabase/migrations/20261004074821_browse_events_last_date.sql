-- The card of a recurring event shows its date range, so also return the last
-- matching date of each group.

create or replace function public.browse_events(
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
language sql stable set search_path = ''
as $function$
  with matching as (
    select e.*, case when c.event_id is not null then jsonb_build_object('latitude',c.latitude,'longitude',c.longitude) end as event_coordinates,
      case when p_group then coalesce(e.series_id,e.id) else e.id end as group_id
    from public.events e left join public.event_coordinates c on c.event_id=e.id
      and c.expires_at>now() and c.coordinate_location=e.location
    where e.status='published'
      and e.start_time >= date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago'
      and (p_ranges is null or exists(select 1 from jsonb_array_elements(p_ranges) r
        where e.start_time >= (r->>'from')::timestamptz and (r->>'to' is null or e.start_time < (r->>'to')::timestamptz)))
      and (p_categories is null or e.categories && p_categories)
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
      count(*) over(partition by group_id) as matching_dates,
      max(start_time) over(partition by group_id) as last_start_time from matching m
  )
  select to_jsonb(r) - array['group_id','position','description','search','dedupe_key','created_by','tags']
  from ranked r where position=1 order by start_time,id;
$function$;
