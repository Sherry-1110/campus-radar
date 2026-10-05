-- Northwestern's own calendars list mostly talks, seminars, info sessions and staff events. From those
-- sources, only events in one of the six site categories are listed; the rest are hidden from browsing
-- but still found by search. Staff-only events are hidden too (faculty recitals and other shows stay).
-- Events from other sources are never hidden.
create or replace function private.is_hidden_event(p_title text, p_source uuid, p_categories public.event_category[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.sources s where s.id = p_source and s.url ~* '(northwestern\.edu|nurecreation\.com)')
    and (
      private.is_internal_event(p_title, p_source)
      or not coalesce(p_categories && array['music', 'arts', 'exhibition', 'sports', 'wellness', 'play', 'market', 'social']::public.event_category[], false)
      or (lower(coalesce(p_title, '')) ~ '\m(staff|employees?|faculty ?(&|and) ?staff|faculty senate)\M'
          and not coalesce(p_categories && array['music', 'arts', 'exhibition']::public.event_category[], false))
    )
$$;

create or replace function private.fill_event_category()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.categories := private.classify_categories(new.title, new.description, new.category);
  new.category := new.categories[1];
  new.is_hidden := private.is_hidden_event(new.title, new.source_id, new.categories);
  return new;
end;
$$;

-- Hidden events stay out of browsing, the map and the featured strip, but a search still finds them.
do $$
declare
  def text := pg_get_functiondef('public.browse_events'::regproc);
  fixed text := replace(def, $s$where e.status='published' and not e.is_hidden$s$, $s$where e.status='published' and (not e.is_hidden or p_term <> '')$s$);
begin
  if fixed = def then raise exception 'browse_events did not have the expected shape'; end if;
  execute fixed;
end;
$$;

update public.events set category = category;
