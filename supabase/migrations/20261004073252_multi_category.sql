-- An event can belong to up to 3 categories (one per site-level group: music
-- counts as arts, wellness as sports, career as academic). `category` stays as
-- the primary one, always the first entry of `categories`, so existing readers
-- and the sync keep working. A trigger derives the list from the source's own
-- category plus keyword matches on the title; rules are heuristics.

alter table public.events
  add column categories public.event_category[] not null default '{}'
  constraint events_categories_max3 check (cardinality(categories) <= 3);

create function private.category_group(p_c public.event_category)
returns text language sql immutable set search_path = ''
as $$ select case p_c when 'music' then 'arts' when 'wellness' then 'sports' when 'career' then 'academic' else p_c::text end $$;

create function private.add_category(p_list public.event_category[], p_c public.event_category)
returns public.event_category[] language sql immutable set search_path = ''
as $$
  select case when cardinality(p_list) >= 3
      or exists (select 1 from unnest(p_list) x where private.category_group(x) = private.category_group(p_c))
    then p_list else p_list || p_c end
$$;

create function private.classify_categories(p_title text, p_description text, p_primary public.event_category)
returns public.event_category[]
language plpgsql immutable set search_path = ''
as $$
declare
  t text := lower(coalesce(p_title, ''));
  d text := lower(left(coalesce(p_description, ''), 300));
  found public.event_category[] := case when p_primary is null or p_primary = 'other' then '{}' else array[p_primary] end;
begin
  if t ~ '\m(lecture|seminar|colloquium|symposium|conference|grand rounds|didactic|journal club|thesis|dissertation|defense|research|book talk|talk|panel|workshop|webinar|m&m)\M' then
    found := private.add_category(found, 'academic');
  end if;
  if t ~ '\m(market|markets|bazaar|flea|swap meet|pop-?up shop|craft fair|artisan fair|maker fair|vendor fair|holiday fair|christkindlmarket)\M' then
    found := private.add_category(found, 'market');
  end if;
  if t ~ '\m(food tour|tasting|brunch|breakfast|lunch|dinner|buffet|pizza|cooking|baking|wine|beer|food truck|taco|burger|ramen|dessert|bbq|restaurant week)\M'
     and t !~ '\m(comedy|improv)\M' then
    -- A lunch or dinner that hosts a talk series is an academic event.
    found := private.add_category(found,
      (case when d ~ '\m(lecture|talk series|research|faculty|seminar)\M' then 'academic' else 'food' end)::public.event_category);
  end if;
  if t ~ '\m(concert|orchestra|symphony|jazz|recital|choir|chorus|quartet|quintet|band|dj|music|musical|opera|karaoke|open mic|singer|songwriter|taiko|a cappella|acapella)\M'
     and t !~ 'improvised musical' then found := private.add_category(found, 'music'); end if;
  if t ~ '\m(comedy|improv|improvised|sketch|stand-?up|theat(er|re)|revue|exhibit|exhibition|gallery|museum|art|arts|film|cinema|screening|dance|ballet|poetry|storytelling|cabaret|magic|circus|variety|mainstage|show|craft|sculpture|photograph\w*|architecture|culture|cultural)\M' then found := private.add_category(found, 'arts'); end if;
  if t ~ '\m(yoga|pilates|zumba|fitness|workout|run|5k|10k|marathon|tournament|basketball|football|soccer|volleyball|tennis|swim\w*|intramural|cycling|spin|hike|climbing|sailing|kayak\w*|athletic\w*|rec|recreation|hockey|baseball|softball|lacrosse|rugby|fencing|boxing|martial arts)\M' then found := private.add_category(found, 'sports'); end if;
  if t ~ '\m(wellness|meditation|mindful\w*|mental health|counseling|massage|self-care|healing|therapy|stress|sleep)\M' then found := private.add_category(found, 'wellness'); end if;
  if t ~ '\m(career|internship|recruit\w*|job|jobs|resume|r[eé]sum[eé]|networking|employer\w*|hiring|interview\w*|career fair|job fair|entrepreneur\w*|startup\w*|founder\w*|pitch)\M' then found := private.add_category(found, 'career'); end if;
  if t ~ '\m(mixer|party|social|hangout|reception|mingle|game night|trivia|open house|coffee hour|celebration|gala|meetup|meet-up|potluck|bonfire|picnic|retreat|fundrais\w*|festival|parade)\M' then found := private.add_category(found, 'social'); end if;

  -- Weaker signals only when nothing else matched.
  if cardinality(found) = 0 then
    if t ~ '\m(class|course|training|orientation|info session|information session|office hours|presentation|lab|study|studies|science|institute|forum|series|discussion|book club|rounds|consultation\w*|drop-in support)\M' then
      found := private.add_category(found, 'academic');
    elsif d ~ '\m(comedy|improv|exhibit\w*|museum|theat(er|re)|gallery)\M' then found := private.add_category(found, 'arts');
    elsif d ~ '\m(concert|orchestra|symphony|jazz)\M' then found := private.add_category(found, 'music');
    elsif d ~ '\m(lecture|seminar|colloquium|symposium|workshop|research)\M' then found := private.add_category(found, 'academic');
    elsif d ~ '\m(yoga|fitness|workout|tournament)\M' then found := private.add_category(found, 'sports');
    end if;
  end if;
  return case when cardinality(found) = 0 then array['other']::public.event_category[] else found end;
end;
$$;

create or replace function private.fill_event_category()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.categories := private.classify_categories(new.title, new.description, new.category);
  new.category := new.categories[1];
  return new;
end;
$$;

drop trigger events_fill_category on public.events;
create trigger events_fill_category
  before insert or update of title, description, category on public.events
  for each row execute function private.fill_event_category();

drop function private.classify_category(text, text);

-- Naming `category` in SET fires the trigger, which fills `categories` for every existing row.
update public.events set category = category;

create index events_categories_idx on public.events using gin (categories);

-- Same as before except category filtering now matches any of an event's categories.
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
      count(*) over(partition by group_id) as matching_dates from matching m
  )
  select to_jsonb(r) - array['group_id','position','description','search','dedupe_key','created_by','tags']
  from ranked r where position=1 order by start_time,id;
$function$;
