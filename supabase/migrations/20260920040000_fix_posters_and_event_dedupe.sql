-- Fix the review findings without changing already-applied migrations.

-- Storage delete requests need SELECT as well as DELETE on the object row.
create policy event_posters_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'event-posters'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- PostgreSQL 17 recomputes existing generated values and preserves the index.
-- ponytail: text locations only; use venue IDs if aliases need deduplication.
alter table public.events alter column dedupe_key set expression as (
  md5(
    regexp_replace(lower(title), '[\s[:punct:]]+', '', 'g')
    || '|' || floor(extract(epoch from (start_time at time zone 'UTC')) / 60)::bigint::text
    || '|' || btrim(regexp_replace(lower(coalesce(location, '')), '\s+', ' ', 'g'))
  )
);

-- Keep the RPC signature, authorization and atomic submission behavior.
-- CREATE OR REPLACE also preserves the existing EXECUTE grants.
create or replace function public.submit_event(
  p_title text,
  p_start_time timestamptz,
  p_end_time timestamptz default null,
  p_description text default null,
  p_location text default null,
  p_location_url text default null,
  p_is_free boolean default false,
  p_fee_text text default null,
  p_category public.event_category default 'other',
  p_tags text[] default '{}',
  p_cover_image_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_school_id uuid;
  v_verified boolean;
  v_event_id uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select p.school_id, p.is_school_verified into v_school_id, v_verified
  from public.profiles p where p.id = v_uid;

  if not coalesce(v_verified, false) then
    raise exception 'A verified school email is required to submit events' using errcode = '42501';
  end if;

  -- Only our HTTPS public bucket URLs are accepted. Reject path traversal,
  -- encoded separators and double encoding; ordinary escaped filenames work.
  if p_cover_image_url is not null and (
    p_cover_image_url !~ '^https://lqirwngvveapraatpibe\.supabase\.co/storage/v1/object/public/event-posters/[^?#[:space:][:cntrl:]]+$'
    or p_cover_image_url ~ '(^|/)\.{1,2}(/|$)'
    or p_cover_image_url ~* '%(2e|2f|5c|25)'
    or strpos(p_cover_image_url, chr(92)) > 0
  ) then
    raise exception 'Cover image must use this project''s event-posters public URL' using errcode = '22023';
  end if;

  insert into public.events (
    school_id, title, description, cover_image_url, start_time, end_time,
    location, location_url, is_free, fee_text, category, tags, status, created_by
  ) values (
    v_school_id, p_title, p_description, p_cover_image_url, p_start_time, p_end_time,
    p_location, p_location_url, p_is_free, p_fee_text, p_category, coalesce(p_tags, '{}'),
    'pending_review', v_uid
  ) returning id into v_event_id;

  insert into public.submissions (event_id, submitted_by) values (v_event_id, v_uid);

  return v_event_id;
end;
$$;
