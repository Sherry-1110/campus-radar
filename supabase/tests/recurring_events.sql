begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  source uuid := (select id from public.sources where name='Choose Chicago');
  first_id uuid; second_id uuid; series uuid; n integer; representative uuid;
begin
  insert into public.events(school_id,source_id,title,location,start_time,source_url,status,category)
  values(school,source,'Recurring test play','Test theater','2099-10-01 19:00Z','https://www.choosechicago.com/event/test-play/2099-10-01/','published','arts') returning id,series_id into first_id,series;
  insert into public.events(school_id,source_id,title,location,start_time,source_url,status,category,is_free)
  values(school,source,'Recurring test play','Test theater','2099-10-02 19:00Z','https://www.choosechicago.com/event/test-play/2099-10-02/','published','arts',true) returning id into second_id;
  if series is null or series <> (select series_id from public.events where id=second_id) then raise exception 'Dated source links must share a series'; end if;
  insert into public.events(school_id,source_id,title,location,start_time,source_url,status,category)
  values(school,source,'Recurring test play','Another theater','2099-10-03 19:00Z','https://www.choosechicago.com/event/test-play/2099-10-03/','published','arts'),
    (school,source,'Recurring test play','Test theater','2099-10-04 19:00Z','https://www.choosechicago.com/event/different-play/2099-10-04/','published','arts'),
    (school,source,'Recurring test play','Test theater','2099-10-05 19:00Z','https://www.choosechicago.com/event/test-play/2099-10-05/','pending_review','arts');
  select count(*) into n from public.browse_events(p_ranges=>'[{"from":"2099-10-01Z","to":"2099-11-01Z"}]');
  if n<>3 then raise exception 'Group before counting: expected 3, got %',n; end if;
  select (event->>'id')::uuid into representative from public.browse_events(p_ranges=>'[{"from":"2099-10-02Z","to":"2099-10-03Z"}]');
  if representative<>second_id then raise exception 'Date filter must run before grouping'; end if;
  select (event->>'id')::uuid into representative from public.browse_events(p_ranges=>'[{"from":"2099-10-01Z","to":"2099-11-01Z"}]',p_free=>true);
  if representative<>second_id then raise exception 'Price filter must run before grouping'; end if;
  insert into public.event_coordinates(event_id,coordinate_location,address_query,latitude,longitude,place_id,expires_at)
  values(first_id,'Test theater','Test theater',40,-87,'outside',now()+interval '1 day'),
    (second_id,'Test theater','Test theater',42,-87,'inside',now()+interval '1 day');
  select (event->>'id')::uuid into representative from public.browse_events(p_located=>true,p_bounds=>'{"south":41,"north":43,"west":-88,"east":-86}');
  if representative<>second_id then raise exception 'Map bounds must filter before choosing a series date'; end if;
  update public.events set is_cancelled=true where id=first_id;
  select (event->>'id')::uuid into representative from public.browse_events(p_ids=>array[first_id,second_id]);
  if representative<>second_id then raise exception 'Prefer the next noncancelled date'; end if;
  update public.events set start_time='2099-10-06 19:00Z' where id=second_id;
  if not exists(select 1 from public.events where id=second_id and series_id=series) then raise exception 'Reschedule must preserve occurrence and series'; end if;
  if (select count(*) from public.events where series_id=series)<>3 then raise exception 'Never delete occurrences'; end if;
  insert into public.events(school_id,source_id,title,description,location,start_time,status)
  select school,source,'Recurring exhibit',repeat('An exact detailed exhibition description. ',5),'Test museum',d,'published'
  from unnest(array['2099-10-01Z'::timestamptz,'2099-10-02Z'::timestamptz]) d;
  if (select count(distinct series_id) from public.events where title='Recurring exhibit')<>1 then raise exception 'Exact long content and venue must group'; end if;
  insert into public.events(school_id,source_id,title,description,location,start_time,status)
  values(school,source,'Recurring exhibit',repeat('A different program. ',10),'Test museum','2099-10-03Z','published');
  if (select count(distinct series_id) from public.events where title='Recurring exhibit')<>2 then raise exception 'Different content must stay separate'; end if;
end $$;
set local role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.browse_events(p_ranges=>'[{"from":"2099-10-01Z","to":"2099-11-01Z"}]');
  if n<>5 then raise exception 'Public grouped browse should only include published events, got %',n; end if;
  select sum((event->>'matching_dates')::int) into n from public.browse_events(p_ranges=>'[{"from":"2099-10-01Z","to":"2099-11-01Z"}]');
  if n<>7 then raise exception 'Pending dates must not inflate visible counts'; end if;
  if exists(select 1 from public.events where title='Recurring test play' and status<>'published') then raise exception 'Pending dates leaked'; end if;
  begin
    delete from public.event_series;
    raise exception 'Anonymous series writes must fail';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
