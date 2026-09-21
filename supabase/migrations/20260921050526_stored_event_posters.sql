create index events_cover_image_url_idx on public.events(cover_image_url) where cover_image_url is not null;
create index ingestion_items_poster_idx on private.ingestion_items((payload->'data'->>'cover_image_url'));

-- Backend-only provenance/cache; public clients only receive the stored image URL.
create table private.event_poster_copies (
  source_url text primary key check (source_url ~ '^https?://'),
  stored_url text not null unique check (stored_url ~ '^https://'),
  created_at timestamptz not null default now()
);
alter table private.event_poster_copies enable row level security;
revoke all on private.event_poster_copies from public,anon,authenticated;
grant select,insert on private.event_poster_copies to service_role;

create function public.get_event_poster_copies(p_urls text[])
returns table(source_url text,stored_url text)
language sql stable security invoker set search_path='' as $$
  select source_url,stored_url from private.event_poster_copies where source_url=any(p_urls);
$$;

create function public.remember_event_poster(p_source_url text,p_storage_path text,p_stored_url text)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer; v_stored text;
begin
  if p_storage_path !~ '^imported/[a-f0-9]{64}\.webp$'
    or p_stored_url !~ '^https://[^/]+/storage/v1/object/public/event-posters/'
    or substring(p_stored_url from '^https://[^/]+/storage/v1/object/public/event-posters/(.*)$') is distinct from p_storage_path
    or not exists(select 1 from storage.objects where bucket_id='event-posters' and name=p_storage_path) then
    raise exception 'Poster must exist in uploaded storage';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('campus-radar-ingestion',0));
  insert into private.event_poster_copies(source_url,stored_url) values(p_source_url,p_stored_url)
    on conflict(source_url) do nothing;
  select stored_url into strict v_stored from private.event_poster_copies where source_url=p_source_url;
  update public.events set cover_image_url=v_stored where cover_image_url=p_source_url;
  get diagnostics v_count=row_count;
  -- Keep reconciliation baselines aligned; leave raw enrichment.base untouched.
  update private.ingestion_items set payload=jsonb_set(payload,'{data,cover_image_url}',to_jsonb(v_stored))
    where payload->'data'->>'cover_image_url'=p_source_url;
  return v_count;
end;
$$;
revoke all on function public.get_event_poster_copies(text[]),public.remember_event_poster(text,text,text) from public,anon,authenticated;
grant execute on function public.get_event_poster_copies(text[]),public.remember_event_poster(text,text,text) to service_role;

create or replace function public.sync_source_events(p_source_name text, p_items jsonb, p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_item jsonb; v_old jsonb; v_items jsonb := '[]'; v_field text; v_result jsonb; v_source uuid; v_preserved boolean; v_fields jsonb; v_poster text;
begin
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Refusing empty or malformed source snapshot';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('campus-radar-ingestion',0));
  select id into strict v_source from public.sources where name=p_source_name and is_active;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_old := null; v_preserved := false; v_fields := '[]';
    select payload into v_old from private.ingestion_items where source_id=v_source and external_id=v_item->>'external_id';
    if v_item ? 'enrichment' and v_old->>'related_url'=v_item->>'related_url' then
      foreach v_field in array array['description','cover_image_url','source_url'] loop
        if (v_old->'enrichment'->'fields') ? v_field
          and (v_item->'enrichment'->>'status'='unavailable' or not ((v_item->'enrichment'->'fields') ? v_field))
          and coalesce(v_item->'enrichment'->'base'->v_field,v_item->'data'->v_field)
            is not distinct from v_old->'enrichment'->'base'->v_field then
          v_item := jsonb_set(v_item,array['data',v_field],v_old->'data'->v_field);
          v_preserved := true; v_fields := v_fields || to_jsonb(v_field);
        end if;
      end loop;
      if v_preserved then
        select jsonb_agg(distinct f order by f) into v_fields from jsonb_array_elements(v_fields || coalesce(v_item->'enrichment'->'fields','[]')) f;
        v_item := jsonb_set(v_item,'{enrichment}',jsonb_build_object(
          'status','enriched','fields',v_fields,
          'base',coalesce(v_old->'enrichment'->'base','{}') || coalesce(v_item->'enrichment'->'base','{}'),
          'chain',case when v_item->'enrichment'->>'status'='unavailable' then v_old->'enrichment'->'chain' else v_item->'enrichment'->'chain' end));
      end if;
    end if;
    -- Resolve after enrichment preservation, including older externally hosted details.
    select stored_url into v_poster from private.event_poster_copies
      where source_url=v_item->'data'->>'cover_image_url';
    if v_poster is not null then
      v_item := jsonb_set(v_item,'{data,cover_image_url}',to_jsonb(v_poster));
    elsif v_item->'data'->>'cover_image_url' is not null
      and not exists(select 1 from private.event_poster_copies where stored_url=v_item->'data'->>'cover_image_url')
      and exists(select 1 from private.event_poster_copies where stored_url=v_old->'data'->>'cover_image_url') then
      -- A failed new download must not replace a working stored copy.
      v_item := jsonb_set(v_item,'{data,cover_image_url}',v_old->'data'->'cover_image_url');
    end if;
    v_items := v_items || jsonb_build_array(v_item);
  end loop;
  v_result := private.sync_source_events(p_source_name,v_items,p_run_id);
  -- Keep discovery attribution even when the event's primary URL is the organizer page.
  update public.event_sources es set source_url=i->>'listing_url'
    from jsonb_array_elements(v_items) i
    where es.source_id=v_source and es.external_id=i->>'external_id'
      and i->>'listing_url' ~ '^https?://' and es.source_url is distinct from i->>'listing_url';
  return v_result;
end;
$$;
revoke all on function public.sync_source_events(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sync_source_events(text,jsonb,uuid) to service_role;

