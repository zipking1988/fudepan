-- pgTAP tests for public.send_recipient_reply (migration 20261210000600_recipient_reply).
-- Demo household from seed.sql plus a fake outsider. All new rows are fake and rolled back.
--   Haruko ..01 care_recipient, Misa ..02 primary_caregiver, Kenta ..03 finance_coordinator.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-0000000000f1',
        'authenticated', 'authenticated', 'outsider.reply.test@example.com', now(), now());
insert into public.households (id, name) values ('e0000000-0000-4000-8000-0000000000f1', 'Reply outsider household');
insert into public.household_members (id, household_id, user_id, display_name, role, is_active)
values ('e2000000-0000-4000-8000-0000000000f1', 'e0000000-0000-4000-8000-0000000000f1',
        'e1000000-0000-4000-8000-0000000000f1', 'Outsider', 'care_recipient', true);

insert into public.notes (id, household_id, uploaded_by, image_path, status)
values ('e3000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-0000000000f1/1763700000000-note.png',
        'pending_review');
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values ('e4000000-0000-4000-8000-0000000000f1', 'd0000000-0000-4000-8000-000000000001',
        'e3000000-0000-4000-8000-0000000000f1', 'Fake reply chain', 'high');
insert into public.care_steps (id, care_chain_id, title, care_category, risk_level, approval_required, status, approval_state)
values ('e5000000-0000-4000-8000-0000000000f1', 'e4000000-0000-4000-8000-0000000000f1',
        'Fake visit', 'appointment', 'high', true, 'pending_review', 'pending');

create temp table snapshot as
select approval_state, status, owner_id, driver_id, companion_id, backup_owner_id, plan_version, task_due_at
from public.care_steps where id = 'e5000000-0000-4000-8000-0000000000f1';
grant select on snapshot to service_role;

set local role service_role;

-- Privileges -----------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.send_recipient_reply(uuid,uuid,text)', 'execute')
          and not has_function_privilege('authenticated', 'public.send_recipient_reply(uuid,uuid,text)', 'execute'),
          'Browser roles cannot execute send_recipient_reply');
select ok(has_function_privilege('service_role', 'public.send_recipient_reply(uuid,uuid,text)', 'execute'),
          'The service role can execute send_recipient_reply');

-- Refusals write nothing -------------------------------------------------------
select throws_ok($$ select public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'd1000000-0000-4000-8000-000000000001', 'hello') $$, 'P0001', 'invalid_input', 'Free text is refused');
select throws_ok($$ select public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'd1000000-0000-4000-8000-000000000001', null) $$, 'P0001', 'invalid_input', 'A missing reply is refused');
select throws_ok($$ select public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'd1000000-0000-4000-8000-000000000002', 'thanks') $$, 'P0001', 'recipient_only', 'A primary caregiver cannot send a recipient reply');
select throws_ok($$ select public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'e1000000-0000-4000-8000-0000000000f1', 'thanks') $$, 'P0001', 'part_not_found', 'A care recipient of another household gets not found');
select throws_ok($$ select public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f9',
  'd1000000-0000-4000-8000-000000000001', 'thanks') $$, 'P0001', 'part_not_found', 'An unknown note gets not found');
select is((select count(*)::int from public.audit_events where note_id = 'e3000000-0000-4000-8000-0000000000f1'), 0,
          'Refused replies write no audit event');

-- Sending ----------------------------------------------------------------------
select is((public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'd1000000-0000-4000-8000-000000000001', 'question')) ->> 'outcome', 'sent', 'Haruko can send "I have a question"');
select is((select count(*)::int from public.audit_events
           where note_id = 'e3000000-0000-4000-8000-0000000000f1' and event_type = 'recipient.replied'), 1,
          'Exactly one recipient.replied audit event');
select is((select payload from public.audit_events
           where note_id = 'e3000000-0000-4000-8000-0000000000f1' and event_type = 'recipient.replied'),
          '{"reply": "question"}'::jsonb, 'The payload is the reply code only');
select results_eq($$ select actor_type, actor_id, care_chain_id from public.audit_events
                     where note_id = 'e3000000-0000-4000-8000-0000000000f1' and event_type = 'recipient.replied' $$,
                  $$ values ('human'::text, 'd1000000-0000-4000-8000-000000000001'::uuid, 'e4000000-0000-4000-8000-0000000000f1'::uuid) $$,
                  'The event is attributed to Haruko and linked to the note''s chain');
select is((select count(*)::int from public.feed_items
           where note_id = 'e3000000-0000-4000-8000-0000000000f1' and kind = 'recipient_replied' and recipient_member_id is null), 1,
          'One household Feed_Item');
select is((select count(*)::int from public.feed_items
           where note_id = 'e3000000-0000-4000-8000-0000000000f1' and kind = 'recipient_replied'
             and recipient_member_id = 'd2000000-0000-4000-8000-000000000002'), 1,
          'One In_App_Reminder to the active primary caregiver (Misa)');
select is((select count(*)::int from public.feed_items
           where note_id = 'e3000000-0000-4000-8000-0000000000f1' and kind = 'recipient_replied'
             and recipient_member_id = 'd2000000-0000-4000-8000-000000000003'), 0,
          'No reminder to a member who is not a primary caregiver');
select results_eq($$ select approval_state, status, owner_id, driver_id, companion_id, backup_owner_id, plan_version, task_due_at
                     from public.care_steps where id = 'e5000000-0000-4000-8000-0000000000f1' $$,
                  $$ select * from snapshot $$, 'A reply changes nothing on the Part');

-- Repeat within 10 minutes ---------------------------------------------------------
select is((public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'd1000000-0000-4000-8000-000000000001', 'question')) ->> 'outcome', 'already_sent', 'The same reply again is not sent twice');
select is((select count(*)::int from public.audit_events
           where note_id = 'e3000000-0000-4000-8000-0000000000f1' and event_type = 'recipient.replied'), 1,
          'The repeat wrote no new audit event');
select is((public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'd1000000-0000-4000-8000-000000000001', 'thanks')) ->> 'outcome', 'sent', 'A different reply is sent');

-- Inactive recipient is refused at processing time --------------------------------
reset role;
update public.household_members set is_active = false where id = 'd2000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$ select public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'd1000000-0000-4000-8000-000000000001', 'thanks') $$, 'P0001', 'part_not_found', 'An inactive care recipient is refused');
reset role;

-- Browser role cannot call it directly -------------------------------------------
set local role authenticated;
select throws_ok($$ select public.send_recipient_reply('e3000000-0000-4000-8000-0000000000f1',
  'd1000000-0000-4000-8000-000000000001', 'thanks') $$, '42501', null, 'A signed-in browser session cannot call it');
reset role;

select * from finish();
rollback;
