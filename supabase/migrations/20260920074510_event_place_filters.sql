-- Place metadata for browsing: is the event on campus or nearby, which region
-- is it in, and (for off-campus events) which neighborhood.
--
-- Values are derived from the free-text `location` by a trigger so every write
-- path (nightly sync, user submissions, curators) is covered without changes.
-- The rules are heuristics; setting area/region/neighborhood explicitly in the
-- same statement as an insert/update overrides them.

create type public.event_area as enum ('campus', 'nearby');
create type public.event_region as enum ('evanston', 'chicago', 'between', 'other');

create function private.classify_place(p_location text, p_source text default null)
returns table (area text, region text, neighborhood text)
language plpgsql
immutable
set search_path = ''
as $$
declare
  clean text := btrim(coalesce(p_location, ''));
  segs text[];
  i int;
  zip text;
  has_state boolean := false;
  city text;
  v_region text;
  v_area text;
  v_hood text;
  v_located boolean := true;
begin
  segs := array(select btrim(x) from unnest(string_to_array(clean, ',')) as x where btrim(x) <> '');
  i := coalesce(array_length(segs, 1), 0);

  -- Peel "60208", "IL 60208" and "IL" off the end, leaving the city segment.
  if i >= 1 and segs[i] ~ '^\d{5}(-\d{4})?$' then
    zip := substring(segs[i] from '^\d{5}');
    i := i - 1;
  elsif i >= 1 and segs[i] ~* '^(IL|Illinois)\s+\d{5}' then
    zip := substring(segs[i] from '\d{5}');
    has_state := true;
    i := i - 1;
  end if;
  if not has_state and i >= 1 and upper(segs[i]) in ('IL', 'ILLINOIS') then
    has_state := true;
    i := i - 1;
  end if;
  if i >= 1 and (zip is not null or has_state) and segs[i] !~ '^\d' then
    city := segs[i];
  end if;

  if city is not null then
    v_region := case
      when lower(city) = 'evanston' then 'evanston'
      when lower(city) = 'chicago' then 'chicago'
      when lower(city) in ('skokie', 'lincolnwood', 'wilmette', 'morton grove', 'niles') then 'between'
      else 'other'
    end;
  elsif clean ~* '\mevanston\M' then
    v_region := 'evanston';
  elsif clean ~* '\mchicago\M' then
    v_region := 'chicago';
  else
    -- Bare venue name or no address: follow the feed (Choose Chicago lists
    -- city events; every other source is Northwestern's own).
    v_located := false;
    v_region := case
      when clean = '' or lower(clean) in ('no location', 'online', 'tbd', 'to be determined', 'virtual')
        or lower(clean) like 'online%' or lower(clean) like '%zoom%' then 'other'
      when p_source = 'Choose Chicago' then 'chicago'
      else 'evanston'
    end;
  end if;

  if zip = '60208'
     or clean ~* '\mnorthwestern\M'
     or clean ~* '(galter|ward building|lurie|feinberg|prentice|rubloff|simpson querrey|\m(303|375) e\.? chicago ave)'
     or (v_region = 'evanston' and clean ~* '(campus dr|sheridan r|arts circle|\m1800 sherman)') then
    v_area := 'campus';
  elsif v_located or p_source = 'Choose Chicago' then
    v_area := 'nearby';
  else
    v_area := 'campus';
  end if;

  if v_area = 'nearby' then
    if v_region = 'chicago' then
      v_hood := case
        when clean ~* 'greektown' then 'Greektown'
        when clean ~* '\mN\.? wells\M' and zip = '60614' then 'Old Town'
        when zip = '60640' and clean ~* '\m5\d{3}\s+N\.?\s+(clark|ashland)' then 'Andersonville'
        else case zip
          when '60601' then 'Loop' when '60602' then 'Loop' when '60603' then 'Loop'
          when '60604' then 'Loop' when '60606' then 'Loop'
          when '60605' then 'South Loop'
          when '60607' then 'West Loop' when '60661' then 'West Loop'
          when '60608' then 'Pilsen'
          when '60609' then 'Back of the Yards'
          when '60610' then 'Old Town'
          when '60611' then 'Streeterville'
          when '60612' then 'Near West Side'
          when '60613' then 'Lakeview' when '60657' then 'Lakeview'
          when '60614' then 'Lincoln Park'
          when '60615' then 'Hyde Park' when '60637' then 'Hyde Park'
          when '60616' then 'Chinatown'
          when '60618' then 'North Center'
          when '60622' then 'Wicker Park'
          when '60623' then 'Little Village'
          when '60625' then 'Lincoln Square'
          when '60626' then 'Rogers Park'
          when '60630' then 'Jefferson Park'
          when '60639' then 'Belmont Cragin'
          when '60640' then 'Uptown'
          when '60641' then 'Portage Park'
          when '60642' then 'River West'
          when '60645' then 'West Ridge' when '60659' then 'West Ridge'
          when '60646' then 'Sauganash'
          when '60647' then 'Logan Square'
          when '60649' then 'South Shore'
          when '60651' then 'Humboldt Park'
          when '60653' then 'Bronzeville'
          when '60654' then 'River North'
          when '60660' then 'Edgewater'
          else null
        end
      end;
    elsif v_region = 'evanston' then
      v_hood := 'Evanston';
    elsif city is not null then
      v_hood := initcap(city);
    end if;
  end if;

  return query select v_area, v_region, v_hood;
end;
$$;

alter table public.events
  add column area public.event_area,
  add column region public.event_region,
  add column neighborhood text check (neighborhood is null or char_length(neighborhood) <= 100);

-- One-time backfill for existing rows.
update public.events e
set area = c.area::public.event_area,
    region = c.region::public.event_region,
    neighborhood = c.neighborhood
from public.events e2
  left join public.sources s on s.id = e2.source_id
  cross join lateral private.classify_place(e2.location, s.name) c
where e2.id = e.id;

alter table public.events
  alter column area set not null,
  alter column region set not null;

create index events_area_region_idx on public.events (area, region);

-- Keep new and edited events classified. An explicit value written together
-- with the change wins over the derived one.
create function private.fill_event_place()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  src text;
begin
  if tg_op = 'INSERT' or new.location is distinct from old.location then
    select s.name into src from public.sources s where s.id = new.source_id;
    select * into c from private.classify_place(new.location, src);
    if tg_op = 'INSERT' then
      new.area := coalesce(new.area, c.area::public.event_area);
      new.region := coalesce(new.region, c.region::public.event_region);
      new.neighborhood := coalesce(new.neighborhood, c.neighborhood);
    else
      if new.area is not distinct from old.area then new.area := c.area::public.event_area; end if;
      if new.region is not distinct from old.region then new.region := c.region::public.event_region; end if;
      if new.neighborhood is not distinct from old.neighborhood then new.neighborhood := c.neighborhood; end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.fill_event_place() from public, anon, authenticated;

create trigger events_fill_place
  before insert or update of location on public.events
  for each row execute function private.fill_event_place();
