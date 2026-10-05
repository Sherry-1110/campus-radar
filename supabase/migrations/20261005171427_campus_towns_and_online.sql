-- "Glencoe, Ill." names a town, not a venue: read "Ill." as Illinois so it is not taken for a campus building.
-- Online events are nowhere, so not on campus either.
do $$
declare
  place text := pg_get_functiondef('private.classify_place(text,text)'::regprocedure);
  pairs text[][] := array[
    [$s$upper(segs[i]) in ('IL', 'ILLINOIS')$s$, $s$upper(segs[i]) in ('IL', 'ILL', 'ILL.', 'ILLINOIS')$s$],
    [$s$elsif p_source = 'Northwestern' and (not v_located$s$,
     $s$elsif p_source = 'Northwestern' and clean !~* '\m(online|virtual|zoom)\M' and (not v_located$s$]];
begin
  for i in 1 .. array_length(pairs, 1) loop
    if position(pairs[i][1] in place) = 0 then raise exception 'classify_place did not have the expected shape (%)', i; end if;
    place := replace(place, pairs[i][1], pairs[i][2]);
  end loop;
  execute place;
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
