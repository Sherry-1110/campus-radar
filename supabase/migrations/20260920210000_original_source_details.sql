-- Keep existing reconciliation intact; merge optional original-page details before it.
alter function public.sync_source_events(text,jsonb,uuid) set schema private;
create function public.sync_source_events(p_source_name text, p_items jsonb, p_run_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_item jsonb; v_old jsonb; v_items jsonb := '[]'; v_field text; v_result jsonb; v_source uuid; v_preserved boolean; v_fields jsonb;
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

alter table public.source_health
  add column detail_checked integer not null default 0 check(detail_checked>=0),
  add column detail_enriched integer not null default 0 check(detail_enriched>=0),
  add column detail_failed integer not null default 0 check(detail_failed>=0);
create or replace function public.finish_source_sync(p_run_id uuid, p_status text, p_summary jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_status not in ('succeeded','failed') then raise exception 'Invalid final status'; end if;
  update public.source_health set status=p_status,completed_at=now(),
    last_success_at=case when p_status='succeeded' then now() else last_success_at end,
    candidates=coalesce((p_summary->>'candidates')::integer,0),posters=coalesce((p_summary->>'posters')::integer,0),
    inserted=coalesce((p_summary->>'inserted')::integer,0),updated=coalesce((p_summary->>'updated')::integer,0),
    unchanged=coalesce((p_summary->>'unchanged')::integer,0),linked=coalesce((p_summary->>'linked')::integer,0),conflicts=coalesce((p_summary->>'conflicts')::integer,0),
    detail_checked=coalesce((p_summary->>'detail_checked')::integer,0),
    detail_enriched=coalesce((p_summary->>'detail_enriched')::integer,0),
    detail_failed=coalesce((p_summary->>'detail_failed')::integer,0),
    error_code=case when p_status='failed' then p_summary->>'error_code' else null end
  where run_id=p_run_id and status='running';
  if not found then raise exception 'Stale or completed source run'; end if;
end;
$$;
