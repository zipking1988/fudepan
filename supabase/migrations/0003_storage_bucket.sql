-- Fudepan Phase 1: private bucket for original note images.
-- Object path convention: "<household_id>/<file name>".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'note-images',
  'note-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy note_images_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'note-images'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );

create policy note_images_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'note-images'
    and public.is_household_member(((storage.foldername(name))[1])::uuid)
  );

-- No update or delete policies: original images are preserved for the audit trail.
