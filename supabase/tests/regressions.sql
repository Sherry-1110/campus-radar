-- Run against a disposable Supabase database after migrations:
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/regressions.sql
-- Each test rolls back its data. Never run this against production.

-- Test: Owners can delete their own posters but cannot access another user's files.
begin;
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'poster-test@northwestern.edu', now()),
  ('22222222-2222-4222-8222-222222222222', 'other-test@northwestern.edu', now());
insert into storage.objects (bucket_id, name) values
  ('event-posters', '11111111-1111-4111-8111-111111111111/poster.png'),
  ('event-posters', '22222222-2222-4222-8222-222222222222/poster.png');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
-- Recent Supabase Storage versions guard direct SQL deletes; this transaction
-- tests RLS only. Application code must delete files through the Storage API.
set local storage.allow_delete_query = 'true';
do $$
declare
  removed integer;
begin
  assert (select count(*) from storage.objects where bucket_id = 'event-posters') = 1,
    'Owner must see only their own poster metadata';
  delete from storage.objects
    where bucket_id = 'event-posters'
      and name = '11111111-1111-4111-8111-111111111111/poster.png';
  get diagnostics removed = row_count;
  assert removed = 1, 'Owner must be able to delete their poster';
  delete from storage.objects
    where bucket_id = 'event-posters'
      and name = '22222222-2222-4222-8222-222222222222/poster.png';
  get diagnostics removed = row_count;
  assert removed = 0, 'Owner must not delete another user''s poster';
end;
$$;
rollback;

-- Test: Submission URLs must stay within the trusted poster bucket.
begin;
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-4111-8111-111111111111', 'url-test@northwestern.edu', now());
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  bad_url text;
  v_event_id uuid;
begin
  foreach bad_url in array array[
    'https://attacker.example/storage/v1/object/public/event-posters/poster.png',
    'https://lqirwngvveapraatpibe.supabase.co.attacker.example/storage/v1/object/public/event-posters/poster.png',
    'https://lqirwngvveapraatpibe.supabase.co@attacker.example/storage/v1/object/public/event-posters/poster.png',
    'http://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/poster.png',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/another-bucket/poster.png',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/../another-bucket/poster.png',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/%2e%2e/another-bucket/poster.png',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/%252e%252e/poster.png',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/a/..%2f../poster.png',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/poster.png?download=true',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/poster.png#fragment',
    'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/' || chr(92) || '../poster.png'
  ] loop
    begin
      perform public.submit_event('Bad URL', '2026-11-01T18:00:00Z', p_cover_image_url => bad_url);
      raise exception 'Accepted unsafe poster URL: %', bad_url;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  assert (select count(*) from public.events) = 0, 'Invalid URLs must leave no events';
  assert (select count(*) from public.submissions) = 0, 'Invalid URLs must leave no submissions';
  v_event_id := public.submit_event('Valid URL', '2026-11-01T18:00:00Z',
    p_cover_image_url => 'https://lqirwngvveapraatpibe.supabase.co/storage/v1/object/public/event-posters/11111111-1111-4111-8111-111111111111/my%20poster.png');
  assert (select status from public.events where id = v_event_id) = 'pending_review';
  assert (select count(*) from public.submissions s where s.event_id = v_event_id) = 1;
  perform public.submit_event('No poster', '2026-11-01T18:00:00Z');
end;
$$;
rollback;

-- Test: Same-time events at different locations coexist; real duplicates fail.
begin;
do $$
declare
  school uuid := (select id from public.schools where slug = 'northwestern');
begin
  insert into public.events (school_id, title, start_time, location) values
    (school, 'Yoga', '2026-11-02T18:00:00Z', 'Studio A'),
    (school, 'Yoga', '2026-11-02T18:00:00Z', 'Studio B');
  assert (select count(*) from public.events where title = 'Yoga') = 2;
  begin
    insert into public.events (school_id, title, start_time, location)
      values (school, 'Yoga!', '2026-11-02T18:00:30Z', '  STUDIO   A  ');
    raise exception 'Accepted duplicate at the same normalized location';
  exception when unique_violation then null;
  end;
  begin
    update public.events set location = 'Studio A' where title = 'Yoga' and location = 'Studio B';
    raise exception 'Location updates must also enforce deduplication';
  exception when unique_violation then null;
  end;
  insert into public.events (school_id, title, start_time) values (school, 'No location', '2026-11-02T18:00:00Z');
  begin
    insert into public.events (school_id, title, start_time, location)
      values (school, 'No location', '2026-11-02T18:00:00Z', '   ');
    raise exception 'Blank and absent locations should deduplicate';
  exception when unique_violation then null;
  end;
end;
$$;
rollback;

-- Test: Chinese titles reach the feed but the long Chinese description does not; a changed source drops its stale translation.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  ev jsonb;
  zh text;
begin
  insert into public.events (school_id, title, description, start_time, category, status, title_zh, description_zh)
    values (school, 'Zh Feed Test', 'Original text', '2099-10-01T20:00:00Z', 'other', 'published', '中文标题', '中文简介');
  select event into ev from public.browse_events(p_term => 'Zh Feed Test') limit 1;
  assert ev->>'title_zh' = '中文标题', 'Feed carries the Chinese title';
  assert not (ev ? 'description_zh'), 'Feed leaves out the Chinese description';
  update public.events set description = 'Changed text' where title = 'Zh Feed Test';
  select description_zh into zh from public.events where title = 'Zh Feed Test';
  assert zh is null, 'Stale description translation is cleared';
  select title_zh into zh from public.events where title = 'Zh Feed Test';
  assert zh = '中文标题', 'Unchanged title keeps its translation';
end;
$$;
rollback;

-- Test: obvious internal events are hidden, but only when they come from a Northwestern calendar.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  nu uuid := (select id from public.sources where url ilike '%planitpurple%');
  other_source uuid := (select id from public.sources where url ilike '%eventbrite%');
  hidden boolean;
begin
  insert into public.events (school_id, title, start_time, source_id, status) values (school, 'DOM Medical Grand Rounds', '2099-12-01T20:00:00Z', nu, 'published') returning is_hidden into hidden;
  assert hidden, 'Grand rounds from Northwestern are hidden';
  insert into public.events (school_id, title, start_time, source_id, status) values (school, 'Grand Rounds Comedy Night', '2099-12-02T20:00:00Z', other_source, 'published') returning is_hidden into hidden;
  assert not hidden, 'Other sources are never hidden';
  insert into public.events (school_id, title, start_time, source_id, status) values (school, 'Fall Concert', '2099-12-03T20:00:00Z', nu, 'published') returning is_hidden into hidden;
  assert not hidden, 'Ordinary Northwestern events stay visible';
  assert not exists (select 1 from public.browse_events(p_categories => array['other','academic']::public.event_category[], p_ranges => '[{"from":"2099-12-01Z","to":"2099-12-02Z"}]')), 'Hidden events are left out of browsing';
  assert exists (select 1 from public.browse_events(p_term => 'DOM Medical Grand Rounds')), 'Hidden events are still found by search';
end;
$$;
rollback;

-- Test: the feed has index-friendly date bounds and still respects open-ended and multiple ranges.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  n integer;
begin
  assert position('min((r->>''from'')::timestamptz)' in pg_get_functiondef('public.browse_events'::regproc)) > 0, 'Feed has a start bound';
  insert into public.events (school_id, title, start_time, category, status) values
    (school, 'Bound Test A', '2099-01-05T20:00:00Z', 'other', 'published'),
    (school, 'Bound Test B', '2099-01-20T20:00:00Z', 'other', 'published');
  select count(*) into n from public.browse_events(p_term => 'Bound Test',
    p_ranges => '[{"from":"2099-01-01Z","to":"2099-01-10Z"},{"from":"2099-01-15Z","to":"2099-01-25Z"}]');
  assert n = 2, 'Two separate ranges both match: ' || n;
  select count(*) into n from public.browse_events(p_term => 'Bound Test', p_ranges => '[{"from":"2099-01-10Z","to":"2099-01-15Z"}]');
  assert n = 0, 'Gap between ranges matches nothing: ' || n;
  select count(*) into n from public.browse_events(p_term => 'Bound Test', p_ranges => '[{"from":"2099-01-10Z","to":null}]');
  assert n = 1, 'Open-ended range: ' || n;
end;
$$;
rollback;

-- Test: everything from a Northwestern site is on campus; other feeds only at a campus address.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  athletics uuid := (select id from public.sources where adapter_key = 'nusports');
  nu uuid := (select id from public.sources where url ilike '%planitpurple%');
  city uuid;
  a public.event_area;
begin
  insert into public.sources (name, type, url) values ('Test city roundup', 'calendar_scrape', 'https://www.example.com/roundup') returning id into city;
  insert into public.events (school_id, title, start_time, source_id, location) values (school, 'City pick', '2099-12-28T20:00:00Z', city, null) returning area into a;
  assert a = 'nearby', 'A city pick with no location is not on campus: ' || a;
  insert into public.events (school_id, title, start_time, source_id, location) values (school, 'City venue', '2099-12-28T21:00:00Z', city, 'Some Theater') returning area into a;
  assert a = 'nearby', 'A bare venue from a city feed is not on campus: ' || a;
  insert into public.events (school_id, title, start_time, source_id, location) values (school, 'City at Norris', '2099-12-28T22:00:00Z', city, '1999 Campus Dr, Evanston, IL 60208') returning area into a;
  assert a = 'campus', 'Any feed at a campus address is on campus: ' || a;
  insert into public.events (school_id, title, start_time, source_id, location) values (school, 'Home game', '2099-12-29T20:00:00Z', athletics, 'Ryan Field, Evanston, Ill.') returning area into a;
  assert a = 'campus', 'An NU home game is on campus: ' || a;
  insert into public.events (school_id, title, start_time, source_id, location) values (school, 'Golf', '2099-12-29T21:00:00Z', athletics, 'Glencoe, Ill.') returning area into a;
  assert a = 'campus', 'Anything from NU Athletics is on campus: ' || a;
  insert into public.events (school_id, title, start_time, source_id, location) values (school, 'NU downtown', '2099-12-29T22:00:00Z', nu, '1601 Sherman Ave, Evanston, IL 60201') returning area into a;
  assert a = 'campus', 'Anything from PlanItPurple is on campus: ' || a;
end;
$$;
rollback;


-- Test: current Jev labels filter events; unresolved text never inherits old/source tags.
begin;
do $$
declare school uuid:=(select id from public.schools limit 1); cats public.event_category[];
begin
  insert into public.events(school_id,title,description,start_time,category,status)
    values(school,'Unresolved music festival','A new listing','2099-03-01T20:00:00Z','music','published') returning categories into cats;
  assert cats=array[]::public.event_category[], 'No category without a current judgment';
  assert exists(select 1 from public.browse_events(p_term=>'Unresolved music festival')), 'Unknown events remain visible under All';
  assert not exists(select 1 from public.browse_events(p_term=>'Unresolved music festival',p_categories=>array['music']::public.event_category[])), 'Unknown events must not match a source tag';
  perform public.remember_event_categories('Unresolved music festival','A new listing',array['music','market']::public.event_category[],'{}','fun-v1','jev-1.13.0');
  assert exists(select 1 from public.browse_events(p_term=>'Unresolved music festival',p_categories=>array['market']::public.event_category[])), 'Accepted secondary labels remain filterable';
  update public.events set description='Changed event text' where title='Unresolved music festival';
  assert (select categories from public.events where title='Unresolved music festival')=array[]::public.event_category[], 'Old accepted judgments cannot follow changed text';
end $$;
rollback;
