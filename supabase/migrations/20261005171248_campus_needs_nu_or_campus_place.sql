-- "On campus" means a place on campus, or a Northwestern feed that names only a venue or the town.
-- Before, any feed other than Choose Chicago counted as Northwestern's own, so city picks with no
-- location landed on campus, while NU home games at "Ryan Field, Evanston, Ill." did not.
do $$
declare
  place text := pg_get_functiondef('private.classify_place(text,text)'::regprocedure);
  fill text := pg_get_functiondef('private.fill_event_place'::regproc);
  pairs text[][] := array[
    [$s$      when p_source = 'Choose Chicago' then 'chicago'
      else 'evanston'$s$,
     $s$      when p_source = 'Northwestern' then 'evanston'
      else 'chicago'$s$],
    [$s$  elsif v_located or p_source = 'Choose Chicago' then
    v_area := 'nearby';
  else
    v_area := 'campus';
  end if;$s$,
     $s$  -- Only a Northwestern feed may leave out the address: a bare venue ("Welsh-Ryan Arena"),
  -- the town alone ("Ryan Field, Evanston, Ill.") or nothing at all.
  elsif p_source = 'Northwestern' and (not v_located or (v_region = 'evanston' and clean !~ '\d')) then
    v_area := 'campus';
  else
    v_area := 'nearby';
  end if;$s$]];
  old_fill text := $s$select s.name into src from public.sources s where s.id = new.source_id;$s$;
begin
  for i in 1 .. array_length(pairs, 1) loop
    if position(pairs[i][1] in place) = 0 then raise exception 'classify_place did not have the expected shape (%)', i; end if;
    place := replace(place, pairs[i][1], pairs[i][2]);
  end loop;
  if position(old_fill in fill) = 0 then raise exception 'fill_event_place did not have the expected shape'; end if;
  execute place;
  execute replace(fill, old_fill,
    $s$select case when s.url ~* '(northwestern\.edu|nurecreation\.com|nusports\.com)' then 'Northwestern' else s.name end
      into src from public.sources s where s.id = new.source_id;$s$);
end;
$$;

-- Recompute feed events; user submissions keep whatever was chosen for them.
with c as (
  select e.id, p.area::public.event_area area, p.region::public.event_region region, p.neighborhood
  from public.events e join public.sources s on s.id = e.source_id
  cross join lateral private.classify_place(e.location,
    case when s.url ~* '(northwestern\.edu|nurecreation\.com|nusports\.com)' then 'Northwestern' else s.name end) p
  where e.created_by is null
)
update public.events e set area = c.area, region = c.region, neighborhood = c.neighborhood
from c
where e.id = c.id and (e.area, e.region, e.neighborhood) is distinct from (c.area, c.region, c.neighborhood);
