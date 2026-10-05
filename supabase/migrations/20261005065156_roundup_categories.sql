-- Big city picks that matched no group: Oktoberfest spin-offs and Día de los Muertos are fests,
-- fashion week is arts, pumpkin nights, house tours and Open House Chicago are things to go and do.
do $$
declare
  def text := pg_get_functiondef('private.classify_categories'::regproc);
  fixed text := def;
  pairs text[][] := array[
    [$s$|block party|parade|art walk)\M' or t ~ '[a-z]fest\M')$s$,
     $s$|block party|parade|art walk|day of the dead|d[ií]a de (los )?muertos)\M' or t ~ '([a-z]fest\M|\moktoberfest)')$s$],
    [$s$|architecture|culture|cultural)\M'$s$, $s$|architecture|culture|cultural|fashion)\M'$s$],
    [$s$|corn maze|pumpkin patch|hayride|$s$, $s$|corn maze|pumpkin patch|pumpkins?|lanterns?|hayride|open house chicago|$s$],
    [$s$|pub|brewery) tours?\M'$s$, $s$|pub|brewery|house|home) tours?\M'$s$]];
begin
  for i in 1 .. array_length(pairs, 1) loop
    if position(pairs[i][1] in fixed) = 0 then raise exception 'classify_categories did not have the expected shape (%)', i; end if;
    fixed := replace(fixed, pairs[i][1], pairs[i][2]);
  end loop;
  execute fixed;
end;
$$;

update public.events set category = category
where lower(title) ~ '(oktoberfest|muertos|day of the dead|fashion|pumpkin|lantern|open house chicago|house tour|home tour)';
