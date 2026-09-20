-- Event lifecycle is independent of curator publication/moderation state.
alter table public.events
  add column is_cancelled boolean not null default false,
  add column is_all_day boolean not null default false;

-- Normalized source snapshots are deliberately not exposed through the Data API.
create table private.ingestion_items (
  source_id uuid not null references public.sources(id) on delete cascade,
  external_id text not null check (char_length(external_id) between 1 and 200),
  event_id uuid not null references public.events(id) on delete cascade,
  payload jsonb not null,
  changed_at timestamptz not null default now(),
  primary key (source_id, external_id)
);
create index ingestion_items_event_idx on private.ingestion_items(event_id);
create table private.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete cascade,
  completed_at timestamptz not null default now(),
  summary jsonb not null
);
create index ingestion_runs_source_idx on private.ingestion_runs(source_id, completed_at desc);
revoke all on private.ingestion_items, private.ingestion_runs from public, anon, authenticated;
grant all on private.ingestion_items, private.ingestion_runs to service_role;

-- One transaction per source: a malformed item rolls back that entire source.
-- SECURITY INVOKER + an explicit service_role grant avoids a privileged public RPC.
create function public.sync_source_events(p_source_name text, p_items jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source uuid;
  v_school uuid;
  v_item jsonb;
  v_old_payload jsonb;
  v_baseline jsonb;
  v_takeover boolean;
  v_event public.events%rowtype;
  v_incoming public.events%rowtype;
  v_previous public.events%rowtype;
  v_patch jsonb;
  v_field text;
  v_id uuid;
  v_key text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_linked integer := 0;
  v_conflicts integer := 0;
  v_summary jsonb;
begin
  if p_source_name not in ('PlanItPurple', 'Bienen School of Music') then
    raise exception 'Unsupported ingestion source';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Refusing empty or malformed source snapshot';
  end if;
  if jsonb_array_length(p_items) > 20000 then
    raise exception 'Source snapshot exceeds 20000 items';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) j group by j->>'external_id' having count(*) > 1) then
    raise exception 'Duplicate source occurrence IDs';
  end if;
  -- Serializes even manual/API runs against each other; no duplicate creation race.
  perform pg_advisory_xact_lock(hashtextextended('campus-radar-ingestion', 0));
  select id into strict v_source from public.sources where name = p_source_name and is_active;
  select id into strict v_school from public.schools where slug = 'northwestern';

  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'external_id', '') = '' or jsonb_typeof(v_item->'data') is distinct from 'object' then
      raise exception 'Missing source identity or event data';
    end if;
    -- Require every managed field; absence must not be interpreted as deletion.
    if not ((v_item->'data') ?& array['title','description','cover_image_url','start_time','end_time',
      'location','location_url','is_free','fee_text','category','is_cancelled','is_all_day','source_url']) then
      raise exception 'Incomplete normalized event';
    end if;
    v_incoming := jsonb_populate_record(null::public.events, v_item->'data');
    if v_incoming.title is null or v_incoming.start_time is null or v_incoming.source_url is null
      or v_incoming.is_cancelled is null or v_incoming.is_all_day is null or v_incoming.is_free is null
      or v_incoming.category is null then
      raise exception 'Missing required event fields';
    end if;

    v_id := null;
    v_old_payload := null;
    select event_id, payload into v_id, v_old_payload from private.ingestion_items
      where source_id = v_source and external_id = v_item->>'external_id';
    if v_old_payload = v_item then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    if v_id is null then
      select event_id into v_id from public.event_sources
        where source_id = v_source and external_id = v_item->>'external_id';
    end if;
    if v_id is null then
      -- Canonical organizer links identify cross-feed copies of the same occurrence.
      select e.id into v_id from public.events e
      where e.school_id = v_school and e.created_by is null
        and abs(extract(epoch from (e.start_time - v_incoming.start_time))) < 60
        and (e.source_url = nullif(v_item->>'related_url', '')
          or exists (select 1 from private.ingestion_items i where i.event_id=e.id
            and (i.payload->>'related_url' = v_incoming.source_url
              or i.payload->'data'->>'source_url' = v_incoming.source_url)))
      order by e.created_at, e.id limit 1;
    end if;
    if v_id is null then
      v_key := md5(regexp_replace(lower(v_incoming.title), '[\s[:punct:]]+', '', 'g')
        || '|' || floor(extract(epoch from (v_incoming.start_time at time zone 'UTC')) / 60)::bigint::text
        || '|' || btrim(regexp_replace(lower(coalesce(v_incoming.location, '')), '\s+', ' ', 'g')));
      select id into v_id from public.events where school_id=v_school and dedupe_key=v_key;
    end if;

    if v_id is null then
      insert into public.events (school_id, title, description, cover_image_url, start_time, end_time,
        location, location_url, is_free, fee_text, category, is_cancelled, is_all_day, source_id, source_url, status)
      values (v_school, v_incoming.title, v_incoming.description, v_incoming.cover_image_url,
        v_incoming.start_time, v_incoming.end_time, v_incoming.location, v_incoming.location_url,
        v_incoming.is_free, v_incoming.fee_text, v_incoming.category, v_incoming.is_cancelled,
        v_incoming.is_all_day, v_source, v_incoming.source_url, 'published') returning id into v_id;
      v_inserted := v_inserted + 1;
    else
      select * into strict v_event from public.events where id=v_id for update;
      v_patch := '{}'::jsonb;
      -- Bienen is the organizer; its direct listing outranks a shared PiP copy.
      v_takeover := p_source_name = 'Bienen School of Music' and v_event.created_by is null
        and exists(select 1 from public.sources where id=v_event.source_id and name='PlanItPurple');
      v_baseline := v_old_payload;
      if v_takeover then
        select payload into v_baseline from private.ingestion_items
          where event_id=v_id and source_id=v_event.source_id order by changed_at desc limit 1;
      end if;
      if (v_event.source_id = v_source or v_takeover) and v_baseline is not null then
        v_previous := jsonb_populate_record(null::public.events, v_baseline->'data');
        foreach v_field in array array['title','description','cover_image_url','start_time','end_time',
          'location','location_url','is_free','fee_text','category','is_cancelled','is_all_day','source_url'] loop
          if (to_jsonb(v_incoming)->v_field) is distinct from (to_jsonb(v_previous)->v_field) then
            if (to_jsonb(v_event)->v_field) is not distinct from (to_jsonb(v_previous)->v_field)
              or v_field = 'is_cancelled' then
              v_patch := v_patch || jsonb_build_object(v_field, to_jsonb(v_incoming)->v_field);
            elsif (to_jsonb(v_event)->v_field) is distinct from (to_jsonb(v_incoming)->v_field) then
              v_conflicts := v_conflicts + 1;
            end if;
          end if;
        end loop;
      elsif (v_event.source_id = v_source or v_takeover) and v_event.created_by is null then
        -- Legacy imports have no baseline for detecting text edits. Keep their
        -- existing content, but bootstrap the newly introduced lifecycle flags.
        v_patch := jsonb_build_object('is_cancelled',v_incoming.is_cancelled,'is_all_day',v_incoming.is_all_day);
        v_conflicts := v_conflicts + 1;
      end if;
      if (v_patch <> '{}'::jsonb and (to_jsonb(v_event) || v_patch) <> to_jsonb(v_event)) or v_takeover then
        v_event := jsonb_populate_record(v_event, v_patch);
        update public.events set title=v_event.title, description=v_event.description,
          cover_image_url=v_event.cover_image_url, start_time=v_event.start_time, end_time=v_event.end_time,
          location=v_event.location, location_url=v_event.location_url, is_free=v_event.is_free,
          fee_text=v_event.fee_text, category=v_event.category, is_cancelled=v_event.is_cancelled,
          is_all_day=v_event.is_all_day, source_url=v_event.source_url,
          source_id=case when v_takeover then v_source else v_event.source_id end where id=v_id;
        if v_old_payload is null then v_linked := v_linked + 1;
        else v_updated := v_updated + 1; end if;
      elsif v_old_payload is null then
        v_linked := v_linked + 1;
      else
        v_unchanged := v_unchanged + 1;
      end if;
    end if;

    insert into public.event_sources(event_id, source_id, external_id, source_url)
      values (v_id, v_source, v_item->>'external_id', v_incoming.source_url)
      on conflict (source_id, external_id) do update set source_url=excluded.source_url, last_seen_at=now();
    insert into private.ingestion_items(source_id, external_id, event_id, payload)
      values (v_source, v_item->>'external_id', v_id, v_item)
      on conflict (source_id, external_id) do update set payload=excluded.payload, changed_at=now();
  end loop;
  v_summary := jsonb_build_object('inserted',v_inserted,'updated',v_updated,'unchanged',v_unchanged,
    'linked',v_linked,'conflicts',v_conflicts,'total',jsonb_array_length(p_items));
  update public.sources set last_fetched_at=now() where id=v_source;
  insert into private.ingestion_runs(source_id,summary) values(v_source,v_summary);
  return v_summary;
end;
$$;
revoke all on function public.sync_source_events(text,jsonb) from public, anon, authenticated;
grant execute on function public.sync_source_events(text,jsonb) to service_role;
