-- "Ball" names a dance ("Symphony Ball") but also a team ("Ball State"): the latter is not a party.
do $$
declare
  def text := pg_get_functiondef('private.classify_categories'::regproc);
  fixed text := replace(def, $s$|rave|ball|gala|$s$, $s$|rave|ball(?! state)|gala|$s$);
begin
  if fixed = def then raise exception 'classify_categories did not have the expected shape'; end if;
  execute fixed;
end;
$$;

update public.events set category = category where lower(title) ~ '\mball\M';
