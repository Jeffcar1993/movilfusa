insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-avatars',
  'client-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists client_avatars_public_read on storage.objects;
create policy client_avatars_public_read
on storage.objects
for select
to public
using (bucket_id = 'client-avatars');

drop policy if exists client_avatars_upload_own on storage.objects;
create policy client_avatars_upload_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'client-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists client_avatars_update_own on storage.objects;
create policy client_avatars_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'client-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'client-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists client_avatars_delete_own on storage.objects;
create policy client_avatars_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'client-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
