-- Chinese text for events. Filled by the translation step; empty means "show the original".
alter table public.events
  add column title_zh text,
  add column location_zh text,
  add column description_zh text;

-- A translation belongs to the text it was made from: if the source text changes and the
-- update does not bring a new translation, drop the old one so it is translated again.
create function private.clear_stale_translations()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.title is distinct from old.title and new.title_zh is not distinct from old.title_zh then new.title_zh := null; end if;
  if new.location is distinct from old.location and new.location_zh is not distinct from old.location_zh then new.location_zh := null; end if;
  if new.description is distinct from old.description and new.description_zh is not distinct from old.description_zh then new.description_zh := null; end if;
  return new;
end;
$$;

create trigger events_clear_stale_translations
  before update of title, location, description on public.events
  for each row execute function private.clear_stale_translations();

-- The feed leaves out long text; keep the Chinese description out of it too.
do $$
begin
  execute replace(pg_get_functiondef('public.browse_events'::regproc),
    $s$'description','search'$s$, $s$'description','description_zh','search'$s$);
end;
$$;
