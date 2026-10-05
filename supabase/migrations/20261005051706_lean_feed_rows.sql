-- The feed built JSON from whole event rows (descriptions, Chinese descriptions, search vectors) for every
-- upcoming event, only to drop those fields again: ~14k buffers per call instead of ~1k, which on a cold
-- cache could pass the 3 s statement timeout. Carry only the fields the cards and map use.
do $$
declare
  def text := pg_get_functiondef('public.browse_events'::regproc);
  lean text;
begin
  lean := replace(replace(def,
    $s$select e.*, case when c.event_id$s$,
    $s$select e.id, e.series_id, e.title, e.title_zh, e.cover_image_url, e.start_time, e.end_time, e.location, e.location_zh,
      e.is_free, e.fee_text, e.category, e.categories, e.area, e.region, e.neighborhood, e.is_cancelled, e.is_all_day,
      e.source_url, e.more_info_url, case when c.event_id$s$),
    $s$to_jsonb(r) - array['group_id','position','description','description_zh','search','dedupe_key','created_by','tags']$s$,
    $s$to_jsonb(r) - array['group_id','position']$s$);
  if lean = def or position('e.*' in lean) > 0 then raise exception 'browse_events did not have the expected shape'; end if;
  execute lean;
end;
$$;
