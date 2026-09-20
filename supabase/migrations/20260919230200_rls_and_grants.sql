-- Access control. "Automatically expose new tables" is off, so every table
-- needs explicit grants in addition to RLS policies. The service_role key
-- (ingestion) bypasses RLS but still needs table privileges.

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role in ('curator', 'admin')
  );
$$;

create function private.is_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_school_verified
  );
$$;

revoke execute on function private.is_staff(), private.is_verified() from public, anon;
grant execute on function private.is_staff(), private.is_verified() to authenticated;

alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.sources enable row level security;
alter table public.events enable row level security;
alter table public.event_sources enable row level security;
alter table public.submissions enable row level security;
alter table public.mailing_list_subscribers enable row level security;

-- Start from zero for the Data API roles regardless of default privileges.
revoke all on table
  public.schools, public.profiles, public.sources, public.events,
  public.event_sources, public.submissions, public.mailing_list_subscribers
from anon, authenticated;

grant all on table
  public.schools, public.profiles, public.sources, public.events,
  public.event_sources, public.submissions, public.mailing_list_subscribers
to service_role;

-- schools
grant select on public.schools to anon, authenticated;
create policy schools_read on public.schools
  for select to anon, authenticated using (true);

-- profiles: own row only (staff can read all); users may only edit display_name.
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_staff on public.profiles
  for select to authenticated using ((select private.is_staff()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- sources: readable by everyone (for attribution), writable by staff.
grant select on public.sources to anon, authenticated;
grant insert, update, delete on public.sources to authenticated;
create policy sources_read on public.sources
  for select to anon, authenticated using (true);
create policy sources_staff_write on public.sources
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- events: public sees published only; authors see their own; staff see/edit all.
-- No policy lets non-staff insert directly: submissions go through submit_event().
grant select on public.events to anon, authenticated;
grant insert, update, delete on public.events to authenticated;
create policy events_read_published on public.events
  for select to anon, authenticated using (status = 'published');
create policy events_read_own on public.events
  for select to authenticated using (created_by = (select auth.uid()));
create policy events_staff_all on public.events
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- event_sources: visible when the parent event is visible to the caller.
grant select on public.event_sources to anon, authenticated;
grant insert, update, delete on public.event_sources to authenticated;
create policy event_sources_read_published on public.event_sources
  for select to anon, authenticated
  using (exists (
    select 1 from public.events e where e.id = event_id and e.status = 'published'
  ));
create policy event_sources_staff_all on public.event_sources
  for all to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- submissions: submitters read their own; staff read and review all.
grant select, update on public.submissions to authenticated;
create policy submissions_select_own on public.submissions
  for select to authenticated using (submitted_by = (select auth.uid()));
create policy submissions_select_staff on public.submissions
  for select to authenticated using ((select private.is_staff()));
create policy submissions_update_staff on public.submissions
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

-- mailing list: anyone can subscribe (insert-only, cannot set confirmed_at
-- or the unsubscribe token); only staff can read.
grant insert (email, frequency, categories) on public.mailing_list_subscribers to anon, authenticated;
grant select on public.mailing_list_subscribers to authenticated;
create policy mailing_list_insert on public.mailing_list_subscribers
  for insert to anon, authenticated with check (confirmed_at is null);
create policy mailing_list_select_staff on public.mailing_list_subscribers
  for select to authenticated using ((select private.is_staff()));

-- Approving/rejecting a submission publishes/rejects the event and stamps the reviewer.
create function private.on_submission_reviewed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_status is distinct from old.review_status then
    new.reviewed_by := (select auth.uid());
    new.reviewed_at := now();
    update public.events
    set status = case new.review_status
      when 'approved' then 'published'::public.event_status
      when 'rejected' then 'rejected'::public.event_status
      else 'pending_review'::public.event_status
    end
    where id = new.event_id;
  end if;
  return new;
end;
$$;

create trigger submissions_on_review before update on public.submissions
  for each row execute function private.on_submission_reviewed();

-- Submit an event for review. Creates the event and its submission atomically,
-- forcing status = pending_review and created_by = caller so nobody can
-- self-publish or spoof authorship.
create function public.submit_event(
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

  if p_cover_image_url is not null
     and p_cover_image_url not like '%/storage/v1/object/public/event-posters/%' then
    raise exception 'Cover image must be uploaded to the event-posters bucket' using errcode = '22023';
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

revoke execute on function public.submit_event(
  text, timestamptz, timestamptz, text, text, text, boolean, text, public.event_category, text[], text
) from public, anon;
grant execute on function public.submit_event(
  text, timestamptz, timestamptz, text, text, text, boolean, text, public.event_category, text[], text
) to authenticated;
