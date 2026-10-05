-- The feed's date ranges arrive as JSON, which the start-time index cannot use, so every call read all
-- upcoming events (~230 MB of buffers) and could hit the 3 s statement timeout. Add the overall earliest
-- start and latest end as plain bounds the index can use; the exact range check below still applies.
do $$
begin
  execute replace(pg_get_functiondef('public.browse_events'::regproc),
    $s$      and (p_ranges is null or exists($s$,
    $s$      and (p_ranges is null or e.start_time >= (select min((r->>'from')::timestamptz) from jsonb_array_elements(p_ranges) r))
      and (p_ranges is null or exists(select 1 from jsonb_array_elements(p_ranges) r where r->>'to' is null)
        or e.start_time < (select max((r->>'to')::timestamptz) from jsonb_array_elements(p_ranges) r))
      and (p_ranges is null or exists($s$);
end;
$$;
