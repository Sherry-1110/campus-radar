-- The date bounds added in feed_range_bounds were written as "(p_ranges is null or start_time >= ...)".
-- Under the function's generic plan that OR keeps them out of the index condition, so every call still
-- walked all upcoming events. Express them without OR (missing bounds become -infinity / infinity).
do $$
declare
  def text := pg_get_functiondef('public.browse_events'::regproc);
  fixed text;
begin
  fixed := replace(replace(def,
    $s$      and (p_ranges is null or e.start_time >= (select min((r->>'from')::timestamptz) from jsonb_array_elements(p_ranges) r))$s$,
    $s$      and e.start_time >= coalesce((select min((r->>'from')::timestamptz) from jsonb_array_elements(p_ranges) r), '-infinity')$s$),
    $s$      and (p_ranges is null or exists(select 1 from jsonb_array_elements(p_ranges) r where r->>'to' is null)
        or e.start_time < (select max((r->>'to')::timestamptz) from jsonb_array_elements(p_ranges) r))$s$,
    $s$      and e.start_time < coalesce((select case when bool_or(r->>'to' is null) then null else max((r->>'to')::timestamptz) end
        from jsonb_array_elements(p_ranges) r), 'infinity')$s$);
  if fixed = def or position('p_ranges is null or e.start_time' in fixed) > 0 then raise exception 'browse_events did not have the expected shape'; end if;
  execute fixed;
end;
$$;
