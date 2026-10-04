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

-- Test: events get up to 3 categories from the source category plus title keywords,
-- one per site group, and category filtering matches any of them.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
  n integer;
begin
  insert into public.events (school_id, title, start_time, category, status)
    values (school, 'Jazz Wine Night', '2099-03-01T20:00:00Z', 'music', 'published') returning categories into cats;
  assert cats = array['music', 'food']::public.event_category[], 'Source category first, then title matches: ' || cats::text;

  insert into public.events (school_id, title, start_time, category)
    values (school, 'Comedy Show and Yoga Party Lecture', '2099-03-02T20:00:00Z', 'other') returning categories into cats;
  assert cardinality(cats) = 3, 'At most 3 categories: ' || cats::text;

  insert into public.events (school_id, title, start_time, category)
    values (school, 'Open Mic', '2099-03-03T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['music']::public.event_category[], 'Music and arts share a group, so only one is kept: ' || cats::text;

  insert into public.events (school_id, title, start_time, category)
    values (school, 'Mystery Item', '2099-03-04T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['other']::public.event_category[], 'Unmatched events stay other';

  assert (select category from public.events where title = 'Jazz Wine Night') = 'music', 'category stays the first entry';
  select count(*) into n from public.browse_events(p_categories => array['food']::public.event_category[],
    p_ranges => '[{"from":"2099-03-01Z","to":"2099-03-02Z"}]');
  assert n = 1, 'Filtering by a secondary category must match';
end;
$$;
rollback;

-- Test: a talk about a topic does not get the topic's category.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Colloquium: The Childcare Market and Stress', '2099-04-01T20:00:00Z', 'academic') returning categories into cats;
  assert cats = array['academic']::public.event_category[], 'Talk topics must not add categories: ' || cats::text;
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Industrial Organization Lunch', '2099-04-02T20:00:00Z', 'academic') returning categories into cats;
  assert cats = array['academic', 'food']::public.event_category[], 'Meals can still be added: ' || cats::text;
end;
$$;
rollback;

-- Test: exhibitions have their own category; a talk about one does not.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Gallery Opening: Paper Worlds', '2099-05-01T20:00:00Z', 'arts') returning categories into cats;
  assert cats = array['arts', 'exhibition']::public.event_category[], 'Exhibition added after the source category: ' || cats::text;
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Museum Exhibit Preview', '2099-05-02T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['exhibition']::public.event_category[], 'Primary exhibition: ' || cats::text;
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Lecture on Museum Collections', '2099-05-03T20:00:00Z', 'academic') returning categories into cats;
  assert cats = array['academic']::public.event_category[], 'Talk topics add nothing: ' || cats::text;
end;
$$;
rollback;
