-- Imported rows have upstream occurrence identities. Their old unique title/time key
-- could merge separate performances or unknown venues before reconciliation decided.
-- Keep the existing uniqueness backstop for manual/unattributed submissions.
alter table public.events alter column dedupe_key set expression as (
  case when source_id is not null then md5(id::text)
  else md5(regexp_replace(lower(title), '[\s[:punct:]]+', '', 'g')
    || '|' || floor(extract(epoch from (start_time at time zone 'UTC')) / 60)::bigint::text
    || '|' || btrim(regexp_replace(lower(coalesce(location, '')), '\s+', ' ', 'g')))
  end
);
create index events_imported_occurrence_idx on public.events(school_id,start_time)
  where created_by is null and source_id is not null;

create function private.normalized_event_text(value text)
returns text language sql immutable strict parallel safe set search_path='' as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(value), '[''’‘"]', '', 'g'),
    '[[:space:][:punct:]–—]+', ' ', 'g')), '');
$$;
create function private.normalized_event_venue(value text)
returns text language sql immutable strict parallel safe set search_path='' as $$
  select case when n in ('tba','tbd','unknown','online','virtual','various locations','multiple locations',
    'multiple venues','chicago','evanston','campus','northwestern university','the second city chicago')
    then null else n end from (select private.normalized_event_text(value) n) v;
$$;
create function private.normalized_event_url(value text)
returns text language plpgsql immutable strict parallel safe set search_path='' as $$
declare parts text[]; host text; path text; query text;
begin
  parts:=regexp_match(btrim(value),'^https?://([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$','i');
  if parts is null or parts[1] ~ '[[:space:]@]' then return null; end if;
  host:=regexp_replace(lower(parts[1]),'^www\.','');
  path:=rtrim(parts[2],'/');
  select string_agg(p,'&' order by p) into query
    from unnest(string_to_array(parts[3],'&')) p
    where p<>'' and split_part(p,'=',1) !~* '^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$';
  -- A site's homepage/calendar is not occurrence evidence.
  if path in ('','/tickets')
    or path ~* '^/(upcoming-events|all-shows)(/.*)?$'
    or path ~* '^/(events|shows|calendar)(/(chicago|evanston|calendar|day|week|month|list|all))?(/[0-9]{4}([/-][0-9]{1,2}){0,2})?$'
    then return null; end if;
  return host||path||case when query is null then '' else '?'||query end;
end;
$$;

create function private.match_source_occurrence(p_school uuid,p_source uuid,p_data jsonb,p_related text)
returns uuid language sql stable security invoker set search_path='' as $$
  with incoming as (
    select (p_data->>'start_time')::timestamptz starts,
      private.normalized_event_text(p_data->>'title') title,
      private.normalized_event_venue(p_data->>'location') venue,
      array[private.normalized_event_url(p_data->>'source_url'),private.normalized_event_url(p_related)] urls
  )
  select (array_agg(e.id))[1]
  from public.events e cross join incoming n
  where e.school_id=p_school and e.created_by is null and e.source_id is not null
    and e.start_time>n.starts-interval '60 seconds' and e.start_time<n.starts+interval '60 seconds'
    -- An already recorded source ID takes priority in the caller. A new ID from
    -- that source is a separate occurrence, even if its title/time happen to match.
    and not exists(select 1 from public.event_sources s where s.event_id=e.id and s.source_id=p_source)
    and (
      private.normalized_event_url(e.source_url)=any(n.urls)
      or exists(select 1 from private.ingestion_items i where i.event_id=e.id and
        (private.normalized_event_url(i.payload->>'related_url')=any(n.urls)
         or private.normalized_event_url(i.payload->'data'->>'source_url')=any(n.urls)))
      or (e.start_time=n.starts and private.normalized_event_text(e.title)=n.title
        and private.normalized_event_venue(e.location)=n.venue)
    )
  having count(*)=1;
$$;
revoke all on function private.normalized_event_text(text),private.normalized_event_venue(text),private.normalized_event_url(text),
  private.match_source_occurrence(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function private.normalized_event_text(text),private.normalized_event_venue(text),private.normalized_event_url(text),
  private.match_source_occurrence(uuid,uuid,jsonb,text) to service_role;

-- Change only the lookup: keep identity, baseline/manual-edit reconciliation,
-- source authority, lifecycle handling, and the public enrichment/poster wrapper.
do $migration$
declare
  definition text; old_lookup text; matches integer;
  -- Bounded by the inspected organizer lookup and the final exact-key lookup.
  -- Whitespace/comments and legacy regex escaping may differ in deployed SQL.
  lookup_pattern text := $pattern$(?s)if\s+v_id\s+is\s+null\s+then\s+(?:--[^\n]*\n\s*)?select\s+e\.id\s+into\s+v_id\s+from\s+public\.events\s+e\s+.*?select\s+id\s+into\s+v_id\s+from\s+public\.events\s+where\s+school_id\s*=\s*v_school\s+and\s+dedupe_key\s*=\s*v_key\s*;\s*end\s+if\s*;$pattern$;
begin
  definition := pg_get_functiondef('private.sync_source_events(text,jsonb,uuid)'::regprocedure);
  select count(*), min(span[1]) into matches,old_lookup
    from regexp_matches(definition,lookup_pattern,'g') as matched(span);
  if matches<>1 then raise exception 'Source reconciliation lookup has changed (% matching blocks)',matches; end if;
  execute replace(definition,old_lookup,$new$if v_id is null then
      v_id := private.match_source_occurrence(v_school,v_source,v_item->'data',v_item->>'related_url');
    end if;$new$);
end;
$migration$;
