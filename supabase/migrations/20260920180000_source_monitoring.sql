-- An explicit adapter key enables automated ingestion; other catalog entries remain manual.
alter table public.sources add column adapter_key text unique,
  add column authority integer not null default 0;
update public.sources set adapter_key='planitpurple', authority=10 where name='PlanItPurple';
update public.sources set adapter_key='bienen', authority=30 where name='Bienen School of Music';
insert into public.sources(name,type,url,adapter_key,authority) values
  ('Choose Chicago','calendar_scrape','https://www.choosechicago.com/events/','choose-chicago',5),
  ('The Garage','calendar_scrape','https://www.thegarage.northwestern.edu/events','garage',30)
on conflict(name) do update set adapter_key=excluded.adapter_key, authority=excluded.authority;

-- Safe public operational metadata only. Detailed errors and payloads stay in job logs.
create table public.source_health (
  source_name text primary key references public.sources(name) on update cascade on delete cascade,
  run_id uuid not null unique,
  status text not null check (status in ('running','succeeded','failed')),
  started_at timestamptz not null,
  completed_at timestamptz,
  last_success_at timestamptz,
  run_url text check (run_url ~ '^https://github.com/Sherry-1110/campus-radar/actions/runs/[0-9]+$'),
  candidates integer not null default 0 check (candidates >= 0),
  posters integer not null default 0 check (posters >= 0 and posters <= candidates),
  inserted integer not null default 0 check (inserted >= 0),
  updated integer not null default 0 check (updated >= 0),
  unchanged integer not null default 0 check (unchanged >= 0),
  linked integer not null default 0 check (linked >= 0),
  conflicts integer not null default 0 check (conflicts >= 0),
  error_code text check (error_code in ('fetch_failed','validation_failed','sync_failed','monitoring_failed'))
);
alter table public.source_health enable row level security;
revoke all on public.source_health from public, anon, authenticated;
grant select on public.source_health to anon, authenticated;
grant all on public.source_health to service_role;
create policy source_health_read on public.source_health for select to anon, authenticated using (true);

create function public.begin_source_sync(p_source_name text, p_run_url text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_run uuid := gen_random_uuid();
begin
  if not exists(select 1 from public.sources where name=p_source_name and is_active and adapter_key is not null) then
    raise exception 'Unsupported ingestion source';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('campus-radar-ingestion', 0));
  insert into public.source_health(source_name,run_id,status,started_at,run_url)
    values(p_source_name,v_run,'running',now(),p_run_url)
  on conflict(source_name) do update set run_id=excluded.run_id,status='running',started_at=excluded.started_at,
    completed_at=null,run_url=excluded.run_url,error_code=null,candidates=0,posters=0,inserted=0,updated=0,unchanged=0,linked=0,conflicts=0;
  return v_run;
end;
$$;
create function public.finish_source_sync(p_run_id uuid, p_status text, p_summary jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_status not in ('succeeded','failed') then raise exception 'Invalid final status'; end if;
  update public.source_health set status=p_status,completed_at=now(),
    last_success_at=case when p_status='succeeded' then now() else last_success_at end,
    candidates=coalesce((p_summary->>'candidates')::integer,0),posters=coalesce((p_summary->>'posters')::integer,0),
    inserted=coalesce((p_summary->>'inserted')::integer,0),updated=coalesce((p_summary->>'updated')::integer,0),
    unchanged=coalesce((p_summary->>'unchanged')::integer,0),linked=coalesce((p_summary->>'linked')::integer,0),conflicts=coalesce((p_summary->>'conflicts')::integer,0),
    error_code=case when p_status='failed' then p_summary->>'error_code' else null end
  where run_id=p_run_id and status='running';
  if not found then raise exception 'Stale or completed source run'; end if;
end;
$$;
revoke all on function public.begin_source_sync(text,text), public.finish_source_sync(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.begin_source_sync(text,text), public.finish_source_sync(uuid,text,jsonb) to service_role;

-- Keep reconciliation behavior; configure source eligibility and authority through sources.
drop function public.sync_source_events(text,jsonb);
create function public.sync_source_events(p_source_name text, p_items jsonb, p_run_id uuid)
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
  if not exists(select 1 from public.sources where name=p_source_name and adapter_key is not null and is_active) then
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
  -- Lock and validate the current attempt before every batch. Superseded jobs cannot write.
  perform 1 from public.source_health where source_name=p_source_name and run_id=p_run_id and status='running' for update;
  if not found then raise exception 'Stale or missing source run'; end if;
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
        and e.start_time > v_incoming.start_time - interval '60 seconds'
        and e.start_time < v_incoming.start_time + interval '60 seconds'
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
      -- Direct organizers outrank campus calendars, which outrank city aggregators.
      v_takeover := v_event.created_by is null and exists(
        select 1 from public.sources current_source, public.sources incoming_source
        where current_source.id=v_event.source_id and incoming_source.id=v_source
          and incoming_source.authority > current_source.authority);
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
revoke all on function public.sync_source_events(text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.sync_source_events(text,jsonb,uuid) to service_role;
