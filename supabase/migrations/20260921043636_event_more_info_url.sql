-- The "More info" target of a listing is the event's real page. Ingestion keeps
-- it in the private snapshot table (payload->>'related_url'); expose it on the
-- event so the site can link to it, and keep it in sync on every nightly sync.
-- Links back to the aggregators themselves are not the real page, so skip them.

alter table public.events
  add column more_info_url text check (more_info_url is null or more_info_url ~* '^https?://');

update public.events e
set more_info_url = x.url
from (
  select distinct on (i.event_id) i.event_id, i.payload->>'related_url' as url
  from private.ingestion_items i
  where nullif(i.payload->>'related_url', '') is not null
    and i.payload->>'related_url' ~* '^https?://'
    and i.payload->>'related_url' !~* '^https?://([^/]*\.)?(choosechicago\.com|planitpurple\.northwestern\.edu)(/|$)'
  order by i.event_id, i.changed_at desc
) x
where x.event_id = e.id;

create function private.sync_more_info_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  select i.payload->>'related_url' into v_url
  from private.ingestion_items i
  where i.event_id = new.event_id
    and nullif(i.payload->>'related_url', '') is not null
    and i.payload->>'related_url' ~* '^https?://'
    and i.payload->>'related_url' !~* '^https?://([^/]*\.)?(choosechicago\.com|planitpurple\.northwestern\.edu)(/|$)'
  order by i.changed_at desc
  limit 1;

  update public.events set more_info_url = v_url
  where id = new.event_id and more_info_url is distinct from v_url;
  return null;
exception when check_violation then
  -- Never let a malformed link break the nightly sync.
  return null;
end;
$$;
revoke all on function private.sync_more_info_url() from public, anon, authenticated;

create trigger ingestion_items_sync_more_info_url
  after insert or update of payload on private.ingestion_items
  for each row execute function private.sync_more_info_url();
