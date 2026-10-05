-- Everything from a Northwestern site counts as on campus, wherever it is held; other feeds only at a campus address.
do $$
declare
  place text := pg_get_functiondef('private.classify_place(text,text)'::regprocedure);
  old text := $s$  -- Only a Northwestern feed may leave out the address: a bare venue ("Welsh-Ryan Arena"),
  -- the town alone ("Ryan Field, Evanston, Ill.") or nothing at all.
  elsif p_source = 'Northwestern' and clean !~* '\m(online|virtual|zoom)\M' and (not v_located or (v_region = 'evanston' and clean !~ '\d')) then$s$;
begin
  if position(old in place) = 0 then raise exception 'classify_place did not have the expected shape'; end if;
  execute replace(place, old, $s$  elsif p_source = 'Northwestern' then$s$);
end;
$$;

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
