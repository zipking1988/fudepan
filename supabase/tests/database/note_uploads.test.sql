-- pgTAP tests for Phase 2: the private notes bucket, upload reservations,
-- and the service-role-only upload functions. Everything is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

-- ---------------------------------------------------------------------------
-- Storage bucket and browser access
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select public, file_size_limit::bigint, allowed_mime_types from storage.buckets where id = 'notes' $$,
  $$ values (false, 10485760::bigint, array['image/jpeg', 'image/png', 'image/webp']) $$,
  'The notes bucket is private, 10 MB, and accepts only JPEG, PNG, and WebP'
);

select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  0,
  'No Storage policies exist, so browser roles cannot upload, read, or list objects'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.note_uploads'::regclass),
  'RLS is enabled on note_uploads'
);

select ok(
  not has_table_privilege('authenticated', 'public.note_uploads', 'select')
  and not has_table_privilege('anon', 'public.note_uploads', 'select')
  and not has_table_privilege('authenticated', 'public.note_uploads', 'insert'),
  'Browser roles have no privileges on note_uploads'
);

select is(
  (
    select count(*)::int
    from (
      values
        ('public.reserve_note_upload(uuid,uuid,uuid,text,text,integer)'),
        ('public.complete_note_upload(uuid,uuid,integer,text)'),
        ('public.claim_note_upload_failure(uuid,uuid)'),
        ('public.record_note_upload_failure(uuid,uuid,text,text,boolean)'),
        ('public.record_note_upload_rejection(uuid,uuid,text,text)'),
        ('public.expire_note_upload(uuid,boolean)')
    ) as f (signature)
    cross join (values ('anon'), ('authenticated')) as r (role)
    where has_function_privilege(r.role, f.signature, 'execute')
  ),
  0,
  'Browser roles cannot execute any upload function'
);

select ok(
  has_function_privilege('service_role', 'public.complete_note_upload(uuid,uuid,integer,text)', 'execute'),
  'The service role can complete uploads'
);

-- ---------------------------------------------------------------------------
-- Fixtures: a second household with its own caregiver
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'e1000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'other.upload.test@example.com',
  now(),
  now()
);
insert into public.households (id, name) values ('e0000000-0000-4000-8000-000000000002', 'Other household');
insert into public.household_members (household_id, user_id, display_name, role)
values (
  'e0000000-0000-4000-8000-000000000002',
  'e1000000-0000-4000-8000-000000000002',
  'Other caregiver',
  'primary_caregiver'
);

set local role service_role;

-- ---------------------------------------------------------------------------
-- Reserving
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002',
       'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000001/1763700000000-note.png',
       'image/png', 2048) $$,
  'A caregiver can reserve an upload in their household'
);

select ok(
  (select expires_at > now() + interval '2 hours 30 minutes'
   from public.note_uploads where note_id = 'f1000000-0000-4000-8000-000000000001'),
  'Reservations outlive the 2-hour signed upload token'
);

-- Changed by task 12.1 (Requirement 1.4): the care recipient may now take the photo.
select lives_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000001',
       'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000002/1763700000000-note.png',
       'image/png', 2048) $$,
  'The care recipient can reserve an upload'
);

select throws_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000002',
       'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000003/1763700000000-note.png',
       'image/png', 2048) $$,
  'P0001', 'not_allowed',
  'A member of another household cannot reserve an upload here'
);

select throws_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-000000000002/f1000000-0000-4000-8000-000000000004/1763700000000-note.png',
       'image/png', 2048) $$,
  '23514', null,
  'A reservation cannot point into another household''s folder'
);

select throws_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002',
       'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000005/1763700000000-mom-insulin.png',
       'image/png', 2048) $$,
  '23514', null,
  'Original file names are never used in storage paths'
);

select throws_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002',
       'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000006/1763700000000-note.jpg',
       'image/png', 2048) $$,
  '23514', null,
  'The file extension must match the content type'
);

select throws_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002',
       'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000007/1763700000000-note.png',
       'image/png', 10485761) $$,
  '23514', null,
  'A reservation cannot exceed 10 MB'
);

select throws_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002',
       'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000008/1763700000000-note.gif',
       'image/gif', 2048) $$,
  '23514', null,
  'Only JPEG, PNG, and WebP can be reserved'
);

-- ---------------------------------------------------------------------------
-- Completing
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_note_upload('f1000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000002', 2048, 'image/png') $$,
  'P0001', 'upload_not_found',
  'Nobody else can complete the upload'
);

select throws_ok(
  $$ select public.complete_note_upload('f1000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 2048, 'image/jpeg') $$,
  'P0001', 'upload_invalid',
  'The stored type must match the reservation'
);

select throws_ok(
  $$ select public.complete_note_upload('f1000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 10485761, 'image/png') $$,
  'P0001', 'upload_invalid',
  'The stored size must be within 10 MB'
);

select isnt(
  public.complete_note_upload('f1000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002', 1900, 'image/png'),
  null,
  'The uploader can complete the upload'
);

select results_eq(
  $$ select household_id, uploaded_by, status, original_text
     from public.notes where id = 'f1000000-0000-4000-8000-000000000001' $$,
  $$ values ('d0000000-0000-4000-8000-000000000001'::uuid, 'd1000000-0000-4000-8000-000000000002'::uuid,
             'uploaded'::text, null::text) $$,
  'The note is saved in its household with status uploaded and no text'
);

select results_eq(
  $$ select actor_type, actor_id, payload from public.audit_events
     where event_type = 'note.uploaded' and payload ->> 'note_id' = 'f1000000-0000-4000-8000-000000000001' $$,
  $$ values ('human'::text, 'd1000000-0000-4000-8000-000000000002'::uuid,
             '{"note_id": "f1000000-0000-4000-8000-000000000001", "content_type": "image/png",
               "size_bytes": 1900, "status": "uploaded"}'::jsonb) $$,
  'Completion writes one note.uploaded audit event with IDs, type, and size only'
);

select throws_ok(
  $$ select public.complete_note_upload('f1000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 1900, 'image/png') $$,
  'P0001', 'upload_not_pending',
  'An upload cannot be completed twice'
);

select is(
  public.claim_note_upload_failure('f1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002'),
  false,
  'A completed upload cannot be claimed as failed, so its image is never removed'
);

-- ---------------------------------------------------------------------------
-- Failures
-- ---------------------------------------------------------------------------
select public.reserve_note_upload(
  'f1000000-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000010/1763700000000-note.jpg',
  'image/jpeg', 4096);

select throws_ok(
  $$ select public.record_note_upload_failure('f1000000-0000-4000-8000-000000000010',
       'd1000000-0000-4000-8000-000000000002', 'upload', 'network_error', false) $$,
  'P0001', 'upload_not_failing',
  'A failure must be claimed before it is recorded'
);

select is(
  public.claim_note_upload_failure('f1000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000002'),
  true,
  'The uploader can claim a pending upload as failed'
);

select throws_ok(
  $$ select public.complete_note_upload('f1000000-0000-4000-8000-000000000010',
       'd1000000-0000-4000-8000-000000000002', 4096, 'image/jpeg') $$,
  'P0001', 'upload_not_pending',
  'A claimed upload can no longer be completed'
);

select throws_ok(
  $$ select public.record_note_upload_failure('f1000000-0000-4000-8000-000000000010',
       'd1000000-0000-4000-8000-000000000002', 'upload', 'Mom''s insulin note', true) $$,
  '22023', null,
  'Audit reasons must be short machine codes, never free text'
);

select lives_ok(
  $$ select public.record_note_upload_failure('f1000000-0000-4000-8000-000000000010',
       'd1000000-0000-4000-8000-000000000002', 'upload', 'network_error', true) $$,
  'The failure is recorded'
);

select results_eq(
  $$ select n.status, a.payload from public.note_uploads n
     join public.audit_events a on a.payload ->> 'note_id' = n.note_id::text and a.event_type = 'note.upload_failed'
     where n.note_id = 'f1000000-0000-4000-8000-000000000010' $$,
  $$ values ('failed'::text, '{"note_id": "f1000000-0000-4000-8000-000000000010", "stage": "upload",
             "reason": "network_error", "object_removed": true}'::jsonb) $$,
  'A failed upload has one note.upload_failed audit event'
);

select throws_ok(
  $$ select public.record_note_upload_rejection('e0000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000002', 'validate', 'too_large') $$,
  'P0001', 'not_member',
  'Rejections are never written into a household the person does not belong to'
);

select is(
  public.expire_note_upload('f1000000-0000-4000-8000-000000000010', true),
  false,
  'Reservations are not expired before their time'
);

-- ---------------------------------------------------------------------------
-- Notes keep their images inside their own household folder
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.notes (id, household_id, uploaded_by, image_path)
     values ('f1000000-0000-4000-8000-000000000020', 'd0000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000002',
             'e0000000-0000-4000-8000-000000000002/f1000000-0000-4000-8000-000000000020/1763700000000-note.png') $$,
  '23514', null,
  'A note image path must be inside its own household and note folder'
);

reset role;

-- ---------------------------------------------------------------------------
-- A signed-in member still cannot use any of this directly
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$ select public.reserve_note_upload(
       'f1000000-0000-4000-8000-000000000030', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002',
       'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000030/1763700000000-note.png',
       'image/png', 2048) $$,
  '42501', null,
  'A member cannot call the upload functions from the browser'
);

select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('notes', 'd0000000-0000-4000-8000-000000000001/f1000000-0000-4000-8000-000000000031/1763700000000-note.png') $$,
  '42501', null,
  'A member cannot write into the notes bucket directly'
);

reset role;

select * from finish();

rollback;
