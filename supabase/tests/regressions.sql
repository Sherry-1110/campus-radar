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
    values (school, 'Comedy Show, Yoga and Dance Party', '2099-03-02T20:00:00Z', 'other') returning categories into cats;
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

-- Test: an exhibition is recognised from an explicit description phrase, but a loose mention is not enough.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, description, start_time, category)
    values (school, 'We the People in Greektown', 'The new public art exhibit celebrates the 250th anniversary.', '2099-06-01T20:00:00Z', 'arts') returning categories into cats;
  assert cats = array['arts', 'exhibition']::public.event_category[], 'Explicit exhibit phrase: ' || cats::text;
  insert into public.events (school_id, title, description, start_time, category)
    values (school, 'Sumo Tournament and Sushi', 'Watch a sumo exhibition match and eat.', '2099-06-02T20:00:00Z', 'sports') returning categories into cats;
  assert cats = array['sports']::public.event_category[], 'Loose mention must not add exhibition: ' || cats::text;
end;
$$;
rollback;

-- Test: shows, concerts and games get the Shows & Games category; talks and game nights do not.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Spring Choir Concert', '2099-07-01T20:00:00Z', 'music') returning categories into cats;
  assert cats = array['music']::public.event_category[], 'Concert: ' || cats::text;
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Northwestern vs. Purdue', '2099-07-02T20:00:00Z', 'sports') returning categories into cats;
  assert cats = array['sports']::public.event_category[], 'Game: ' || cats::text;
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Board Game Night', '2099-07-03T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['play']::public.event_category[], 'Game night is an activity: ' || cats::text;
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Seminar: Game Theory Tournament', '2099-07-04T20:00:00Z', 'academic') returning categories into cats;
  assert cats = array['academic']::public.event_category[], 'Talks add nothing: ' || cats::text;
end;
$$;
rollback;

-- Test: a food event is recognised from explicit description phrases when the title has no keyword.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, description, start_time, category)
    values (school, 'Taste of Portugal', 'Portuguese Restaurant Week celebrates culinary traditions.', '2099-08-01T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['food']::public.event_category[], 'Food from description: ' || cats::text;
end;
$$;
rollback;

-- Test: events you join in with get the Play category; talks about them do not.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Escape Room Night', '2099-09-01T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['play']::public.event_category[], 'Escape room: ' || cats::text;
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Trivia Night', '2099-09-02T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['play']::public.event_category[], 'Trivia is an activity: ' || cats::text;
  insert into public.events (school_id, title, start_time, category)
    values (school, 'Seminar: Interactive Learning', '2099-09-03T20:00:00Z', 'academic') returning categories into cats;
  assert cats = array['academic']::public.event_category[], 'Talks add nothing: ' || cats::text;
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

-- Test: the six site categories — fests, parties and activities — come from the title; career fairs and receptions do not count.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, start_time, category) values (school, '10th Annual Lincoln Park Wine Fest', '2099-11-01T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['market', 'food']::public.event_category[], 'Food festival is a fest: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Mocktoberfest', '2099-11-02T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['market']::public.event_category[], 'Words ending in fest: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Northshore College Fair', '2099-11-03T20:00:00Z', 'other') returning categories into cats;
  assert not ('market' = any(cats)), 'College fairs are not fests: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Lincoln Brunch Fest', '2099-11-04T20:00:00Z', 'other') returning categories into cats;
  assert not ('play' = any(cats)), 'A brunch festival is a fest, not an activity: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Grad Student Mixer', '2099-11-05T20:00:00Z', 'other') returning categories into cats;
  assert cats = array['social']::public.event_category[], 'Mixer is a party: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Retirement Reception', '2099-11-06T20:00:00Z', 'social') returning categories into cats;
  assert cats = array['other']::public.event_category[], 'A source''s social label alone is not a party: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Chicago Architecture River Tour', '2099-11-07T20:00:00Z', 'other') returning categories into cats;
  assert 'play' = any(cats), 'River tour is an activity: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'The Residents – Chicago – Eskimo Live! Tour', '2099-11-08T20:00:00Z', 'music') returning categories into cats;
  assert not ('play' = any(cats)), 'A concert tour is not an activity: ' || cats::text;
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

-- Test: "vintage" alone is not a market.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, start_time, category) values (school, 'Vintage Tunes, Modern Gal', '2099-12-10T20:00:00Z', 'music') returning categories into cats;
  assert not ('market' = any(cats)), 'Vintage concert is not a fest: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Vintage Market Pop-Up', '2099-12-11T20:00:00Z', 'other') returning categories into cats;
  assert 'market' = any(cats), 'Vintage market is a fest: ' || cats::text;
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

-- Test: from Northwestern calendars only the six site categories are listed, and staff-only events are hidden.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  nu uuid := (select id from public.sources where url ilike '%planitpurple%');
  other_source uuid := (select id from public.sources where url ilike '%eventbrite%');
  hidden boolean;
begin
  insert into public.events (school_id, title, start_time, source_id, status) values (school, 'Analysis Seminar | Visiting Speaker', '2099-12-05T20:00:00Z', nu, 'published') returning is_hidden into hidden;
  assert hidden, 'A Northwestern seminar is hidden';
  insert into public.events (school_id, title, start_time, source_id, status) values (school, 'Study Abroad Info Session', '2099-12-05T21:00:00Z', other_source, 'published') returning is_hidden into hidden;
  assert not hidden, 'Other sources keep their talks';
  insert into public.events (school_id, title, start_time, source_id, status) values (school, 'Fall 2026 Staff All-Level Yoga', '2099-12-06T20:00:00Z', nu, 'published') returning is_hidden into hidden;
  assert hidden, 'Staff-only events are hidden';
  insert into public.events (school_id, title, start_time, source_id, status, category) values (school, 'Faculty Recital: Piano', '2099-12-07T20:00:00Z', nu, 'published', 'music') returning is_hidden into hidden;
  assert not hidden, 'Faculty recitals are shows and stay';
  insert into public.events (school_id, title, start_time, source_id, status) values (school, 'Spanish Club Noche de Trivia', '2099-12-08T20:00:00Z', nu, 'published') returning is_hidden into hidden;
  assert not hidden, 'Fun Northwestern events stay';
end;
$$;
rollback;

-- Test: Sports means games; gym classes are wellness and hidden when they come from Northwestern; NU Athletics games show.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  nu uuid := (select id from public.sources where url ilike '%planitpurple%');
  athletics uuid := (select id from public.sources where adapter_key = 'nusports');
  cats public.event_category[];
  hidden boolean;
begin
  assert athletics is not null, 'NU Athletics source exists';
  insert into public.events (school_id, title, start_time, source_id, status, category) values (school, 'Vinyasa Flow', '2099-12-20T20:00:00Z', nu, 'published', 'sports') returning categories, is_hidden into cats, hidden;
  assert cats = array['wellness']::public.event_category[] and hidden, 'Gym class is hidden wellness: ' || cats::text;
  insert into public.events (school_id, title, start_time, source_id, status, category) values (school, 'Northwestern Football vs. Ball State', '2099-12-21T20:00:00Z', athletics, 'published', 'sports') returning categories, is_hidden into cats, hidden;
  assert 'sports' = any(cats) and not hidden, 'Varsity game is a visible sport: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Standup Throw Down: Millennials vs Gen X', '2099-12-22T20:00:00Z', 'other') returning categories into cats;
  assert not ('sports' = any(cats)), 'A comedy "vs" is not a game: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Chicago Bulls vs. Memphis Grizzlies', '2099-12-23T20:00:00Z', 'sports') returning categories into cats;
  assert cats = array['sports']::public.event_category[], 'Pro game: ' || cats::text;
end;
$$;
rollback;

-- Test: "Ball State" is a team, not a party; a ball is still a party.
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
begin
  insert into public.events (school_id, title, start_time, category) values (school, 'Northwestern Football vs. Ball State', '2099-12-24T20:00:00Z', 'sports') returning categories into cats;
  assert not ('social' = any(cats)), 'Ball State is not a party: ' || cats::text;
  insert into public.events (school_id, title, start_time, category) values (school, 'Symphony Ball', '2099-12-25T20:00:00Z', 'other') returning categories into cats;
  assert 'social' = any(cats), 'A ball is a party: ' || cats::text;
end;
$$;
rollback;

-- Test: big city picks land in a group instead of "other".
begin;
do $$
declare
  school uuid := (select id from public.schools limit 1);
  cats public.event_category[];
  pick record;
begin
  for pick in select * from (values
    ('Oktoberfestiversary', 'market'), ('Día de los Muertos Xicágo', 'market'), ('Chicago Fashion Week', 'arts'),
    ('The Night of 1,000 Jack-o’-Lanterns', 'play'), ('Jack’s Pumpkin Pop-Up', 'play'),
    ('Historic Pullman House Tour', 'play'), ('Open House Chicago', 'play')) v(title, expected)
  loop
    insert into public.events (school_id, title, start_time, category) values (school, pick.title, '2099-12-26T20:00:00Z', 'other') returning categories into cats;
    assert pick.expected::public.event_category = any(cats), pick.title || ': ' || cats::text;
  end loop;
  insert into public.events (school_id, title, start_time, category) values (school, 'Graduate School Open House', '2099-12-27T20:00:00Z', 'other') returning categories into cats;
  assert not ('play' = any(cats)), 'An admissions open house is not an outing: ' || cats::text;
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

