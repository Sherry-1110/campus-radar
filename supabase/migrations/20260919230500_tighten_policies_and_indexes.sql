-- Follow-up from the Supabase advisors: lock down the platform's auto-RLS
-- function, index remaining foreign keys, and merge overlapping SELECT
-- policies so each role/action has a single permissive policy.

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
exception when insufficient_privilege then
  raise notice 'Could not revoke execute on public.rls_auto_enable(); do it from the dashboard.';
end;
$$;

create index events_source_id_idx on public.events (source_id);
create index profiles_school_id_idx on public.profiles (school_id);
create index submissions_reviewed_by_idx on public.submissions (reviewed_by);

-- profiles
drop policy profiles_select_own on public.profiles;
drop policy profiles_select_staff on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));

-- sources
drop policy sources_staff_write on public.sources;
create policy sources_staff_insert on public.sources
  for insert to authenticated with check ((select private.is_staff()));
create policy sources_staff_update on public.sources
  for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy sources_staff_delete on public.sources
  for delete to authenticated using ((select private.is_staff()));

-- events
drop policy events_read_published on public.events;
drop policy events_read_own on public.events;
drop policy events_staff_all on public.events;
create policy events_read_anon on public.events
  for select to anon using (status = 'published');
create policy events_read_authenticated on public.events
  for select to authenticated
  using (
    status = 'published'
    or created_by = (select auth.uid())
    or (select private.is_staff())
  );
create policy events_staff_insert on public.events
  for insert to authenticated with check ((select private.is_staff()));
create policy events_staff_update on public.events
  for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy events_staff_delete on public.events
  for delete to authenticated using ((select private.is_staff()));

-- event_sources: the subquery is itself subject to events RLS, so this is
-- visible exactly when the parent event is visible to the caller.
drop policy event_sources_read_published on public.event_sources;
drop policy event_sources_staff_all on public.event_sources;
create policy event_sources_read on public.event_sources
  for select to anon, authenticated
  using (exists (select 1 from public.events e where e.id = event_id));
create policy event_sources_staff_insert on public.event_sources
  for insert to authenticated with check ((select private.is_staff()));
create policy event_sources_staff_update on public.event_sources
  for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy event_sources_staff_delete on public.event_sources
  for delete to authenticated using ((select private.is_staff()));

-- submissions
drop policy submissions_select_own on public.submissions;
drop policy submissions_select_staff on public.submissions;
create policy submissions_select on public.submissions
  for select to authenticated
  using (submitted_by = (select auth.uid()) or (select private.is_staff()));
