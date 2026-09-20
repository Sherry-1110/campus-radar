-- Public-read bucket for event posters. Verified users upload into a folder
-- named after their user id; ingestion uploads with the service_role key.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-posters', 'event-posters', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

create policy event_posters_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'event-posters'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.is_verified())
  );

create policy event_posters_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'event-posters'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
