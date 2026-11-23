-- pgTAP tests for task 12.1: replaced private.can_upload_notes and
-- public.complete_note_upload (recognition run, note-linked audit event,
-- and Feed_Item written in the same transaction). Everything is rolled back.
-- Requires the demo seed (Demo household d0..01; members d1..01 care_recipient,
-- d1..02 primary_caregiver, d1..03 finance_coordinator).

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- Outsider: active member of another household only.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'e1000000-0000-4000-8000-000000000012',
  'authenticated', 'authenticated', 'outsider.recognition.test@example.com', now(), now()
);
insert into public.households (id, name) values ('e0000000-0000-4000-8000-000000000012', 'Other household');
insert into public.household_members (household_id, user_id, display_name, role)
values ('e0000000-0000-4000-8000-000000000012', 'e1000000-0000-4000-8000-000000000012',
        'Outsider', 'primary_caregiver');

-- Inactive member of the demo household.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'e1000000-0000-4000-8000-000000000013',
  'authenticated', 'authenticated', 'inactive.recognition.test@example.com', now(), now()
);
insert into public.household_members (household_id, user_id, display_name, role, is_active)
values ('d0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013',
        'Former member', 'primary_caregiver', false);

set local role service_role;

-- ---------------------------------------------------------------------------
-- private.can_upload_notes
-- ---------------------------------------------------------------------------
select ok(
  private.can_upload_notes('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001'),
  'The care recipient can upload in their own household'
);
select ok(
  private.can_upload_notes('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002')
  and private.can_upload_notes('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003'),
  'Caregiver roles can still upload'
);
select ok(
  not private.can_upload_notes('d0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000012'),
  'A member of another household cannot upload here'
);
select ok(
  not private.can_upload_notes('d0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000013'),
  'An inactive member cannot upload'
);

-- ---------------------------------------------------------------------------
-- Care recipient reserves and completes
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.reserve_note_upload(
       'f2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000001',
       'd0000000-0000-4000-8000-000000000001/f2000000-0000-4000-8000-000000000001/1763700000000-note.jpg',
       'image/jpeg', 3000) $$,
  'The care recipient can reserve an upload'
);

select throws_ok(
  $$ select public.reserve_note_upload(
       'f2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000012',
       'd0000000-0000-4000-8000-000000000001/f2000000-0000-4000-8000-000000000002/1763700000000-note.jpg',
       'image/jpeg', 3000) $$,
  'P0001', 'not_allowed',
  'An outsider cannot reserve an upload in this household'
);

select isnt(
  public.complete_note_upload('f2000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001', 2900, 'image/jpeg'),
  null,
  'The care recipient can complete the upload'
);

select results_eq(
  $$ select a.note_id, a.household_id, a.actor_id, a.payload
     from public.audit_events a
     where a.event_type = 'note.uploaded' and a.note_id = 'f2000000-0000-4000-8000-000000000001' $$,
  $$ values ('f2000000-0000-4000-8000-000000000001'::uuid, 'd0000000-0000-4000-8000-000000000001'::uuid,
             'd1000000-0000-4000-8000-000000000001'::uuid,
             '{"note_id": "f2000000-0000-4000-8000-000000000001", "content_type": "image/jpeg",
               "size_bytes": 2900, "status": "uploaded"}'::jsonb) $$,
  'Exactly one note.uploaded event has note_id set and holds IDs, type, and size only'
);

select results_eq(
  $$ select status, attempt, household_id, started_by
     from public.recognition_runs where note_id = 'f2000000-0000-4000-8000-000000000001' $$,
  $$ values ('queued'::text, 1, 'd0000000-0000-4000-8000-000000000001'::uuid,
             'd1000000-0000-4000-8000-000000000001'::uuid) $$,
  'Exactly one queued run with attempt 1 exists for the note'
);

select results_eq(
  $$ select f.kind, f.params, f.recipient_member_id, f.actor_member_id, f.audit_event_id = a.id
     from public.feed_items f
     join public.audit_events a on a.note_id = f.note_id and a.event_type = 'note.uploaded'
     where f.note_id = 'f2000000-0000-4000-8000-000000000001' $$,
  $$ values ('event_created'::text, '{"state": "recognizing"}'::jsonb, null::uuid,
             'd2000000-0000-4000-8000-000000000001'::uuid, true) $$,
  'Exactly one household Feed_Item event_created (recognizing) links to the upload event'
);

select results_eq(
  $$ select status from public.notes where id = 'f2000000-0000-4000-8000-000000000001' $$,
  $$ values ('uploaded'::text) $$,
  'The note is saved with status uploaded'
);

-- ---------------------------------------------------------------------------
-- Idempotency: a repeat call changes nothing
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_note_upload('f2000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000001', 2900, 'image/jpeg') $$,
  'P0001', 'upload_not_pending',
  'A repeat call is refused as before'
);

select is(
  (select (select count(*) from public.recognition_runs where note_id = 'f2000000-0000-4000-8000-000000000001')
        + (select count(*) from public.audit_events where note_id = 'f2000000-0000-4000-8000-000000000001' and event_type = 'note.uploaded')
        + (select count(*) from public.feed_items where note_id = 'f2000000-0000-4000-8000-000000000001')),
  3::bigint,
  'After the repeat call there is still one run, one audit event, and one Feed_Item'
);

-- ---------------------------------------------------------------------------
-- Existing refusals keep working; a refused call leaves nothing behind
-- ---------------------------------------------------------------------------
select public.reserve_note_upload(
  'f2000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000001/f2000000-0000-4000-8000-000000000003/1763700000000-note.png',
  'image/png', 2048);

select throws_ok(
  $$ select public.complete_note_upload('f2000000-0000-4000-8000-000000000003',
       'd1000000-0000-4000-8000-000000000001', 2048, 'image/png') $$,
  'P0001', 'upload_not_found',
  'Only the person who reserved the upload can complete it'
);

select throws_ok(
  $$ select public.complete_note_upload('f2000000-0000-4000-8000-000000000003',
       'd1000000-0000-4000-8000-000000000002', 2048, 'image/jpeg') $$,
  'P0001', 'upload_invalid',
  'A type mismatch is still refused'
);

select is(
  (select count(*)::int from public.recognition_runs where note_id = 'f2000000-0000-4000-8000-000000000003')
  + (select count(*)::int from public.feed_items where note_id = 'f2000000-0000-4000-8000-000000000003'),
  0,
  'Refused completions create no run and no Feed_Item'
);

-- Active-run uniqueness holds at the table level.
select throws_ok(
  $$ insert into public.recognition_runs (household_id, note_id)
     values ('d0000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001') $$,
  '23505', null,
  'A second active run for the same note is refused by the unique index'
);

reset role;

select * from finish();

rollback;
