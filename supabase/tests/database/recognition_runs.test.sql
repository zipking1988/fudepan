-- pgTAP tests for task 12.2: start_recognition_run, save_care_chain_draft,
-- fail_recognition_run, resume_stale_recognition_runs. Everything is rolled back.
-- Requires the demo seed (Demo household d0..01; members d2..01 care_recipient
-- with user d1..01, d2..02 primary_caregiver with user d1..02).

begin;

create extension if not exists pgtap with schema extensions;

select plan(76);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Outsider (member of another household only) and an inactive demo member.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000021',
   'authenticated', 'authenticated', 'outsider.runs.test@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000022',
   'authenticated', 'authenticated', 'inactive.runs.test@example.com', now(), now());
insert into public.households (id, name) values ('e0000000-0000-4000-8000-000000000021', 'Other household');
insert into public.household_members (household_id, user_id, display_name, role)
values ('e0000000-0000-4000-8000-000000000021', 'e1000000-0000-4000-8000-000000000021',
        'Outsider', 'primary_caregiver');
insert into public.household_members (household_id, user_id, display_name, role, is_active)
values ('d0000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000022',
        'Former member', 'primary_caregiver', false);

-- Notes N1..N7 in the demo household, N8 in the other household.
insert into public.notes (id, household_id, uploaded_by, image_path, status, original_text)
select
  ('f3000000-0000-4000-8000-00000000000' || n)::uuid,
  'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-00000000000' || n || '/1763700000000-note.jpg',
  'uploaded',
  case when n = 5 then 'secret note text' end
from generate_series(1, 7) n;
insert into public.notes (id, household_id, uploaded_by, image_path, status)
values ('f3000000-0000-4000-8000-000000000008', 'e0000000-0000-4000-8000-000000000021',
        'e1000000-0000-4000-8000-000000000021',
        'e0000000-0000-4000-8000-000000000021/f3000000-0000-4000-8000-000000000008/1763700000000-note.jpg',
        'uploaded');

-- One queued run per note, as complete_note_upload creates them.
insert into public.recognition_runs (id, household_id, note_id, status, attempt, started_by)
select
  ('f4000000-0000-4000-8000-00000000000' || n)::uuid,
  case when n = 8 then 'e0000000-0000-4000-8000-000000000021'::uuid
       else 'd0000000-0000-4000-8000-000000000001'::uuid end,
  ('f3000000-0000-4000-8000-00000000000' || n)::uuid,
  'queued', 1,
  case when n = 8 then 'e1000000-0000-4000-8000-000000000021'::uuid
       else 'd1000000-0000-4000-8000-000000000001'::uuid end
from generate_series(1, 8) n;

-- A valid draft. Titles, names, and questions are recognizable strings so the
-- privacy tests can look for them.
create function public.zz_test_draft() returns jsonb
language sql
as $$
  select $json$
  {
    "chain_title": "Aunt clinic visit",
    "overall_risk": "high",
    "steps": [
      {"title": "Go to the clinic on Friday", "description": "Bring the card",
       "care_category": "appointment", "risk_level": "high",
       "suggested_role": "driver", "person_to_ask": "Misa",
       "evidence_required": ["Receipt"], "approval_required": true,
       "approval_state": "pending", "source_quote": "clinic Fri 2:30",
       "confidence": 0.8, "due_at": "2026-12-18T05:30:00Z",
       "escalation_at": "2026-12-18T04:30:00Z"},
      {"title": "Buy glasses cleaner", "description": null,
       "care_category": "household", "risk_level": "low",
       "suggested_role": null, "person_to_ask": null,
       "evidence_required": [], "approval_required": false,
       "approval_state": "not_required", "source_quote": "cleaner",
       "confidence": 0.9, "due_at": "2026-12-20T09:00:00Z", "escalation_at": null},
      {"title": "Pick up the new medicine", "description": null,
       "care_category": "medication", "risk_level": "high",
       "suggested_role": "family member", "person_to_ask": null,
       "evidence_required": ["Photo of receipt"], "approval_required": true,
       "approval_state": "pending", "source_quote": "pickup medicine",
       "confidence": 0.7, "due_at": null, "escalation_at": null}
    ],
    "ambiguities": [
      {"step_index": 0, "kind": "time", "question": "What time is the clinic visit?"},
      {"step_index": 2, "kind": "location", "question": "Which pharmacy?"},
      {"step_index": null, "kind": "person", "question": "Who is Misa?"}
    ]
  }
  $json$::jsonb;
$$;

-- Write-order log: one row per insert or update on the draft tables.
create table public.zz_order_log (seq bigserial primary key, what text not null);
grant all on public.zz_order_log to public;
create function public.zz_log_write() returns trigger
language plpgsql security definer
as $$
begin
  insert into public.zz_order_log (what) values (tg_table_name || ':' || tg_op);
  return null;
end;
$$;
create trigger zz_log_chains after insert or update on public.care_chains
  for each row execute function public.zz_log_write();
create trigger zz_log_steps after insert or update on public.care_steps
  for each row execute function public.zz_log_write();
create trigger zz_log_details after insert or update on public.part_missing_details
  for each row execute function public.zz_log_write();
create trigger zz_log_audit after insert or update on public.audit_events
  for each row execute function public.zz_log_write();
create trigger zz_log_notes after insert or update on public.notes
  for each row execute function public.zz_log_write();
create trigger zz_log_runs after insert or update on public.recognition_runs
  for each row execute function public.zz_log_write();
create trigger zz_log_feed after insert or update on public.feed_items
  for each row execute function public.zz_log_write();

set local role service_role;

-- ---------------------------------------------------------------------------
-- start_recognition_run
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.start_recognition_run('f3000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000021') $$,
  'P0001', 'part_not_found',
  'A member of another household cannot start a run (same answer as not found)'
);
select throws_ok(
  $$ select public.start_recognition_run('f3000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000022') $$,
  'P0001', 'part_not_found',
  'An inactive member cannot start a run'
);
select throws_ok(
  $$ select public.start_recognition_run('f3000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000001', 0) $$,
  'P0001', 'invalid_input',
  'A lease of zero seconds is refused'
);
select throws_ok(
  $$ select public.start_recognition_run('f3000000-0000-4000-8000-0000000000ff',
       'd1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'part_not_found',
  'An unknown note is refused'
);
select is(
  (select public.start_recognition_run('f3000000-0000-4000-8000-000000000001',
     'd1000000-0000-4000-8000-000000000001') ->> 'outcome'),
  'started',
  'The care recipient claims the queued run'
);
select results_eq(
  $$ select r.status, r.attempt, r.lease_expires_at > now() + interval '170 seconds',
            (select n.status from public.notes n where n.id = r.note_id)
     from public.recognition_runs r where r.id = 'f4000000-0000-4000-8000-000000000001' $$,
  $$ values ('running'::text, 1, true, 'extracting'::text) $$,
  'The run is running with a 3 minute lease and the note is extracting'
);
select results_eq(
  $$ select j ->> 'outcome', j ->> 'run_id', (j ->> 'attempt')::int, j ->> 'started'
     from (select public.start_recognition_run('f3000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000002') as j) s $$,
  $$ values ('already_running'::text, 'f4000000-0000-4000-8000-000000000001'::text, 1, 'false'::text) $$,
  'A second start returns the existing active run instead of a second one'
);
select is(
  (select count(*)::int from public.recognition_runs where note_id = 'f3000000-0000-4000-8000-000000000001')
  + (select count(*)::int from public.audit_events
     where note_id = 'f3000000-0000-4000-8000-000000000001' and event_type = 'extraction_started'),
  2,
  'One run and one extraction_started event exist after two starts'
);

-- ---------------------------------------------------------------------------
-- save_care_chain_draft: happy path
-- ---------------------------------------------------------------------------
delete from public.zz_order_log;

select is(
  (select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000001', public.zz_test_draft()) ->> 'outcome'),
  'created',
  'A valid draft is saved'
);

select results_eq(
  $$ select c.title, c.status, c.risk_level, c.created_by_ai,
            (select count(*)::int from public.care_steps s where s.care_chain_id = c.id)
     from public.care_chains c where c.note_id = 'f3000000-0000-4000-8000-000000000001' $$,
  $$ values ('Aunt clinic visit'::text, 'pending_review'::text, 'high'::text, true, 3) $$,
  'One pending_review chain with three Parts exists for the note'
);

select is(
  (select count(*)::int
   from public.care_steps s
   join public.care_chains c on c.id = s.care_chain_id
   where c.note_id = 'f3000000-0000-4000-8000-000000000001'
     and (s.owner_id is not null or s.backup_owner_id is not null
          or s.driver_id is not null or s.companion_id is not null
          or s.respond_by_at is not null or s.task_due_at is not null
          or s.status <> 'pending_review')),
  0,
  'No Part has a holder or a human time, and every Part starts as pending_review'
);

select results_eq(
  $$ select s.title, s.suggested_role, s.person_to_ask, s.due_at, s.escalation_at
     from public.care_steps s join public.care_chains c on c.id = s.care_chain_id
     where c.note_id = 'f3000000-0000-4000-8000-000000000001'
     order by s.created_at, s.title $$,
  $$ values
       ('Buy glasses cleaner'::text, null::text, null::text, '2026-12-20 09:00:00+00'::timestamptz, null::timestamptz),
       ('Go to the clinic on Friday', 'driver', 'Misa', null, null),
       ('Pick up the new medicine', 'family member', null, null, null) $$,
  'Suggested role and person to ask are text only, and the appointment Part keeps no model times'
);

select is(
  (select count(*)::int
   from public.care_steps s join public.care_chains c on c.id = s.care_chain_id
   where c.note_id = 'f3000000-0000-4000-8000-000000000001'
     and s.approval_state is distinct from (case when s.approval_required then 'pending' else 'not_required' end)),
  0,
  'approval_state is pending exactly when approval is required'
);

select results_eq(
  $$ select s.title, d.kind, d.question_code, d.ai_question, d.resolved_at is null
     from public.part_missing_details d join public.care_steps s on s.id = d.care_step_id
     join public.care_chains c on c.id = d.care_chain_id
     where c.note_id = 'f3000000-0000-4000-8000-000000000001'
     order by d.kind $$,
  $$ values
       ('Pick up the new medicine'::text, 'location'::text, 'ai_question'::text, 'Which pharmacy?'::text, true),
       ('Go to the clinic on Friday', 'time', 'ai_question', 'What time is the clinic visit?', true) $$,
  'Missing details are stored for ambiguities that name a Part; the one without a Part is dropped'
);

select results_eq(
  $$ select a.actor_type, a.actor_id, a.note_id, a.household_id, a.payload
     from public.audit_events a
     where a.event_type = 'extraction_succeeded' and a.note_id = 'f3000000-0000-4000-8000-000000000001' $$,
  $$ select 'ai'::text, null::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid,
            'd0000000-0000-4000-8000-000000000001'::uuid,
            jsonb_build_object(
              'note_id', 'f3000000-0000-4000-8000-000000000001',
              'run_id', 'f4000000-0000-4000-8000-000000000001',
              'care_chain_id', (select c.id from public.care_chains c where c.note_id = 'f3000000-0000-4000-8000-000000000001'),
              'step_count', 3, 'ambiguity_count', 2, 'overall_risk', 'high') $$,
  'Exactly one extraction_succeeded event, actor ai, with the note and counts only'
);

select is(
  (select count(*)::int
   from public.care_steps s join public.care_chains c on c.id = s.care_chain_id
   where c.note_id = 'f3000000-0000-4000-8000-000000000001'
     and s.audit_event_id is distinct from
         (select a.id from public.audit_events a
          where a.event_type = 'extraction_succeeded' and a.note_id = c.note_id)),
  0,
  'Every Part audit_event_id equals the extraction_succeeded event'
);

select results_eq(
  $$ select n.status, r.status, r.lease_expires_at is null,
            r.care_chain_id = (select c.id from public.care_chains c where c.note_id = n.id)
     from public.notes n join public.recognition_runs r on r.note_id = n.id
     where n.id = 'f3000000-0000-4000-8000-000000000001' $$,
  $$ values ('pending_review'::text, 'succeeded'::text, true, true) $$,
  'The note is pending_review and the run succeeded and points at the chain'
);

select results_eq(
  $$ select f.kind, f.params, f.recipient_member_id, f.actor_member_id,
            f.audit_event_id = (select a.id from public.audit_events a
                                where a.event_type = 'extraction_succeeded' and a.note_id = f.note_id),
            f.care_chain_id is not null
     from public.feed_items f where f.note_id = 'f3000000-0000-4000-8000-000000000001' $$,
  $$ values ('event_ready'::text, '{"step_count": 3, "ambiguity_count": 2}'::jsonb, null::uuid, null::uuid, true, true) $$,
  'One household event_ready Feed_Item replaces "Being read" and links to the success event'
);

reset role;
select ok(
  (select max(seq) from public.zz_order_log where what = 'care_chains:INSERT')
    < (select min(seq) from public.zz_order_log where what = 'care_steps:INSERT')
  and (select max(seq) from public.zz_order_log where what = 'care_steps:INSERT')
    < (select min(seq) from public.zz_order_log where what = 'part_missing_details:INSERT')
  and (select max(seq) from public.zz_order_log where what = 'part_missing_details:INSERT')
    < (select min(seq) from public.zz_order_log where what = 'audit_events:INSERT')
  and (select min(seq) from public.zz_order_log where what = 'audit_events:INSERT')
    < (select min(seq) from public.zz_order_log where what = 'care_steps:UPDATE')
  and (select max(seq) from public.zz_order_log where what = 'care_steps:UPDATE')
    < (select min(seq) from public.zz_order_log where what = 'notes:UPDATE')
  and (select min(seq) from public.zz_order_log where what = 'notes:UPDATE')
    < (select min(seq) from public.zz_order_log where what = 'recognition_runs:UPDATE')
  and (select min(seq) from public.zz_order_log where what = 'recognition_runs:UPDATE')
    < (select min(seq) from public.zz_order_log where what = 'feed_items:INSERT'),
  'Write order: chain, Parts, missing details, success event, backfill, note, run, Feed_Item'
);
select is(
  (select count(*)::int from public.zz_order_log where what = 'audit_events:INSERT'),
  1,
  'The save writes exactly one audit event'
);
select ok(
  (select a.created_at from public.audit_events a
   where a.event_type = 'extraction_succeeded' and a.note_id = 'f3000000-0000-4000-8000-000000000001')
  > (select a.created_at from public.audit_events a
     where a.event_type = 'extraction_started' and a.note_id = 'f3000000-0000-4000-8000-000000000001'),
  'The success event is newer than the started event'
);

drop trigger zz_log_chains on public.care_chains;
drop trigger zz_log_steps on public.care_steps;
drop trigger zz_log_details on public.part_missing_details;
drop trigger zz_log_audit on public.audit_events;
drop trigger zz_log_notes on public.notes;
drop trigger zz_log_runs on public.recognition_runs;
drop trigger zz_log_feed on public.feed_items;

set local role service_role;

-- ---------------------------------------------------------------------------
-- Idempotency and one Usable_Draft per note
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select j ->> 'outcome', j ->> 'created',
            (j ->> 'care_chain_id')::uuid = (select c.id from public.care_chains c
                                             where c.note_id = 'f3000000-0000-4000-8000-000000000001')
     from (select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000001',
             public.zz_test_draft()) as j) s $$,
  $$ values ('existing'::text, 'false'::text, true) $$,
  'A second save for a succeeded run returns the existing chain'
);
select is(
  (select count(*)::int from public.care_chains where note_id = 'f3000000-0000-4000-8000-000000000001')
  + (select count(*)::int from public.care_steps s join public.care_chains c on c.id = s.care_chain_id
     where c.note_id = 'f3000000-0000-4000-8000-000000000001')
  + (select count(*)::int from public.audit_events
     where note_id = 'f3000000-0000-4000-8000-000000000001' and event_type = 'extraction_succeeded')
  + (select count(*)::int from public.feed_items where note_id = 'f3000000-0000-4000-8000-000000000001'),
  1 + 3 + 1 + 1,
  'The repeat wrote nothing: one chain, three Parts, one success event, one Feed_Item'
);
select results_eq(
  $$ select j ->> 'outcome', j ->> 'started',
            (j ->> 'care_chain_id')::uuid = (select c.id from public.care_chains c
                                             where c.note_id = 'f3000000-0000-4000-8000-000000000001')
     from (select public.start_recognition_run('f3000000-0000-4000-8000-000000000001',
             'd1000000-0000-4000-8000-000000000001') as j) s $$,
  $$ values ('done'::text, 'false'::text, true) $$,
  'Starting a run for a note that has a Usable_Draft returns done with the chain'
);

-- A second running run for the same note (inserted directly) cannot add a draft.
reset role;
insert into public.recognition_runs (id, household_id, note_id, status, attempt, lease_expires_at)
values ('f4000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001', 'running', 2, now() + interval '3 minutes');
set local role service_role;

select results_eq(
  $$ select j ->> 'outcome', j ->> 'created'
     from (select public.save_care_chain_draft('f4000000-0000-4000-8000-0000000000a1',
             public.zz_test_draft()) as j) s $$,
  $$ values ('existing'::text, 'false'::text) $$,
  'A second run cannot create a second draft'
);
select results_eq(
  $$ select r.status, (select count(*)::int from public.care_chains c where c.note_id = r.note_id)
     from public.recognition_runs r where r.id = 'f4000000-0000-4000-8000-0000000000a1' $$,
  $$ values ('superseded'::text, 1) $$,
  'The extra run is superseded and the note still has one Usable_Draft'
);

-- ---------------------------------------------------------------------------
-- Refused drafts and all-or-nothing rollback (note 2)
-- ---------------------------------------------------------------------------
select is(
  (select public.start_recognition_run('f3000000-0000-4000-8000-000000000002',
     'd1000000-0000-4000-8000-000000000002') ->> 'outcome'),
  'started',
  'Note 2 run started'
);

select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000002',
       jsonb_set(jsonb_set(public.zz_test_draft(), '{steps,2,approval_required}', 'false'),
                 '{steps,2,approval_state}', '"not_required"')) $$,
  'P0001', 'invalid_input',
  'A medication Part without approval is refused'
);
select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000002',
       jsonb_set(public.zz_test_draft(), '{steps,1,approval_state}', '"pending"')) $$,
  'P0001', 'invalid_input',
  'An approval_state that disagrees with approval_required is refused'
);
select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000002',
       jsonb_set(public.zz_test_draft(), '{steps}',
                 (select jsonb_agg(public.zz_test_draft() -> 'steps' -> 1) from generate_series(1, 51)))) $$,
  'P0001', 'invalid_input',
  'More than 50 Parts are refused'
);
select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000002',
       jsonb_set(public.zz_test_draft(), '{ambiguities,0,step_index}', '7')) $$,
  'P0001', 'invalid_input',
  'An ambiguity that points past the last Part is refused'
);
select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-0000000000ff', public.zz_test_draft()) $$,
  'P0001', 'part_not_found',
  'An unknown run is refused'
);

reset role;
create function public.zz_fail_step() returns trigger
language plpgsql
as $$
begin
  if new.title = 'Boom step' then
    raise exception 'forced step failure';
  end if;
  return new;
end;
$$;
create trigger zz_fail_step before insert on public.care_steps
  for each row execute function public.zz_fail_step();
set local role service_role;

select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000002',
       jsonb_set(public.zz_test_draft(), '{steps,1,title}', '"Boom step"')) $$,
  'P0001', 'forced step failure',
  'A failure while inserting the second Part aborts the save'
);

reset role;
drop trigger zz_fail_step on public.care_steps;
create function public.zz_fail_audit() returns trigger
language plpgsql
as $$
begin
  if new.event_type = 'extraction_succeeded' then
    raise exception 'forced audit failure';
  end if;
  return new;
end;
$$;
create trigger zz_fail_audit before insert on public.audit_events
  for each row execute function public.zz_fail_audit();
set local role service_role;

select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000002', public.zz_test_draft()) $$,
  'P0001', 'forced audit failure',
  'A failure while writing the success event aborts the save'
);

select results_eq(
  $$ select
       (select count(*)::int from public.care_chains where note_id = 'f3000000-0000-4000-8000-000000000002'),
       (select count(*)::int from public.care_steps where title in ('Boom step', 'Go to the clinic on Friday')
          and care_chain_id in (select id from public.care_chains where household_id = 'd0000000-0000-4000-8000-000000000001'
                                and note_id = 'f3000000-0000-4000-8000-000000000002')),
       (select count(*)::int from public.audit_events
          where note_id = 'f3000000-0000-4000-8000-000000000002' and event_type = 'extraction_succeeded'),
       (select count(*)::int from public.feed_items where note_id = 'f3000000-0000-4000-8000-000000000002'),
       (select n.status from public.notes n where n.id = 'f3000000-0000-4000-8000-000000000002'),
       (select r.status from public.recognition_runs r where r.id = 'f4000000-0000-4000-8000-000000000002') $$,
  $$ values (0, 0, 0, 0, 'extracting'::text, 'running'::text) $$,
  'After the failed saves there is no chain, Part, success event, or Feed_Item; note and run are unchanged'
);
select is(
  (select count(*)::int from public.part_missing_details where ai_question = 'Which pharmacy?'
     and care_chain_id in (select id from public.care_chains where note_id = 'f3000000-0000-4000-8000-000000000002')),
  0,
  'No missing details remain from the rolled-back saves'
);

-- The caller then fails the run.
reset role;
drop trigger zz_fail_audit on public.audit_events;
set local role service_role;

select throws_ok(
  $$ select public.fail_recognition_run('f4000000-0000-4000-8000-000000000002', 'Model said: take 2 pills') $$,
  'P0001', 'invalid_input',
  'A reason that is not a plain code is refused'
);
select results_eq(
  $$ select j ->> 'outcome', j ->> 'attempt'
     from (select public.fail_recognition_run('f4000000-0000-4000-8000-000000000002',
             'save_failed', true) as j) s $$,
  $$ values ('failed'::text, '1'::text) $$,
  'fail_recognition_run marks the run failed'
);
select results_eq(
  $$ select r.status, r.failure_reason, r.lease_expires_at is null,
            (select n.status from public.notes n where n.id = r.note_id)
     from public.recognition_runs r where r.id = 'f4000000-0000-4000-8000-000000000002' $$,
  $$ values ('failed'::text, 'save_failed'::text, true, 'extraction_failed'::text) $$,
  'The run is failed with the reason code and the note is extraction_failed'
);
select results_eq(
  $$ select a.actor_type, a.actor_id, a.note_id, a.payload
     from public.audit_events a
     where a.event_type = 'extraction_failed' and a.note_id = 'f3000000-0000-4000-8000-000000000002' $$,
  $$ values ('system'::text, null::uuid, 'f3000000-0000-4000-8000-000000000002'::uuid,
             '{"note_id": "f3000000-0000-4000-8000-000000000002",
               "run_id": "f4000000-0000-4000-8000-000000000002",
               "attempt": 1, "reason": "save_failed", "retryable": true}'::jsonb) $$,
  'One extraction_failed event holds IDs, attempt, reason code, and retryable only'
);
select results_eq(
  $$ select f.kind, f.params, f.recipient_member_id, f.audit_event_id = a.id
     from public.feed_items f
     join public.audit_events a on a.note_id = f.note_id and a.event_type = 'extraction_failed'
     where f.note_id = 'f3000000-0000-4000-8000-000000000002' $$,
  $$ values ('event_unreadable'::text,
             '{"reason": "save_failed", "retryable": true, "attempt": 1}'::jsonb,
             null::uuid, true) $$,
  'One household event_unreadable Feed_Item allows a retry'
);
select results_eq(
  $$ select j ->> 'outcome' from (select public.fail_recognition_run(
       'f4000000-0000-4000-8000-000000000002', 'save_failed', true) as j) s $$,
  $$ values ('already_failed'::text) $$,
  'Failing a failed run again is a no-op'
);
select is(
  (select count(*)::int from public.audit_events
   where note_id = 'f3000000-0000-4000-8000-000000000002' and event_type = 'extraction_failed')
  + (select count(*)::int from public.feed_items where note_id = 'f3000000-0000-4000-8000-000000000002'),
  2,
  'The repeat added no event and no Feed_Item'
);
select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000002', public.zz_test_draft()) $$,
  'P0001', 'invalid_input',
  'A failed run cannot save a draft'
);

-- ---------------------------------------------------------------------------
-- Retry after failure (note 2), one Usable_Draft at the end
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.start_recognition_run('f3000000-0000-4000-8000-000000000002',
       'e1000000-0000-4000-8000-000000000021') $$,
  'P0001', 'part_not_found',
  'An outsider cannot retry a failed run'
);
select throws_ok(
  $$ select public.start_recognition_run('f3000000-0000-4000-8000-000000000002', null) $$,
  'P0001', 'part_not_found',
  'The sweeper cannot create a retry run'
);
select results_eq(
  $$ select j ->> 'outcome', (j ->> 'attempt')::int
     from (select public.start_recognition_run('f3000000-0000-4000-8000-000000000002',
             'd1000000-0000-4000-8000-000000000001') as j) s $$,
  $$ values ('started'::text, 2) $$,
  'A member retry starts a new run with attempt 2'
);
select results_eq(
  $$ select count(*)::int, count(*) filter (where status in ('queued', 'running'))::int,
            max(attempt), (select n.status from public.notes n where n.id = 'f3000000-0000-4000-8000-000000000002')
     from public.recognition_runs where note_id = 'f3000000-0000-4000-8000-000000000002' $$,
  $$ values (2, 1, 2, 'extracting'::text) $$,
  'The failed run is kept, one run is active, and the note is extracting again'
);
select results_eq(
  $$ select f.kind, f.params from public.feed_items f
     where f.note_id = 'f3000000-0000-4000-8000-000000000002' and f.kind = 'event_created' $$,
  $$ values ('event_created'::text, '{"state": "recognizing", "retry": true}'::jsonb) $$,
  'The retry shows the note as being read again'
);
select results_eq(
  $$ select j ->> 'outcome', j ->> 'run_id' = r.id::text
     from (select public.start_recognition_run('f3000000-0000-4000-8000-000000000002',
             'd1000000-0000-4000-8000-000000000002') as j) s,
          public.recognition_runs r
     where r.note_id = 'f3000000-0000-4000-8000-000000000002' and r.status = 'running' $$,
  $$ values ('already_running'::text, true) $$,
  'A repeated retry tap returns the same active run'
);
select results_eq(
  $$ select j ->> 'outcome'
     from (select public.save_care_chain_draft(
             (select r.id from public.recognition_runs r
              where r.note_id = 'f3000000-0000-4000-8000-000000000002' and r.status = 'running'),
             public.zz_test_draft()) as j) s $$,
  $$ values ('created'::text) $$,
  'The retry run saves a draft'
);
select results_eq(
  $$ select (select count(*)::int from public.care_chains where note_id = 'f3000000-0000-4000-8000-000000000002'),
            (select n.status from public.notes n where n.id = 'f3000000-0000-4000-8000-000000000002'),
            (select count(*)::int from public.feed_items
             where note_id = 'f3000000-0000-4000-8000-000000000002' and kind = 'event_ready') $$,
  $$ values (1, 'pending_review'::text, 1) $$,
  'After failure and retry the note has exactly one Usable_Draft'
);

-- ---------------------------------------------------------------------------
-- Stale leases (note 5): re-queue up to 3 attempts, then fail
-- ---------------------------------------------------------------------------
select is(
  (select public.start_recognition_run('f3000000-0000-4000-8000-000000000005',
     'd1000000-0000-4000-8000-000000000001', 60) ->> 'outcome'),
  'started',
  'Note 5 run started with a 60 second lease'
);

select results_eq(
  $$ select j ->> 'note_id' from public.resume_stale_recognition_runs(now(), 50,
       'd0000000-0000-4000-8000-000000000001') j
     where j ->> 'note_id' = 'f3000000-0000-4000-8000-000000000005' $$,
  $$ select null::text where false $$,
  'A run with a live lease is not resumed'
);

reset role;
update public.recognition_runs set lease_expires_at = now() - interval '1 second'
where id = 'f4000000-0000-4000-8000-000000000005';
set local role service_role;

select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000005', public.zz_test_draft()) $$,
  'P0001', 'invalid_input',
  'A run whose lease has expired cannot save a draft'
);

select results_eq(
  $$ select j ->> 'action', (j ->> 'attempt')::int, j ->> 'run_id'
     from public.resume_stale_recognition_runs(now(), 50, 'd0000000-0000-4000-8000-000000000001') j
     where j ->> 'note_id' = 'f3000000-0000-4000-8000-000000000005' $$,
  $$ values ('restart'::text, 2, 'f4000000-0000-4000-8000-000000000005'::text) $$,
  'The sweeper returns the stale run for restart as attempt 2'
);
select results_eq(
  $$ select r.status, r.attempt, r.lease_expires_at is null,
            (select n.status from public.notes n where n.id = r.note_id),
            (select n.original_text from public.notes n where n.id = r.note_id)
     from public.recognition_runs r where r.id = 'f4000000-0000-4000-8000-000000000005' $$,
  $$ values ('queued'::text, 2, true, 'extracting'::text, 'secret note text'::text) $$,
  'The run is queued again and the note text is untouched'
);
select results_eq(
  $$ select j ->> 'outcome', (j ->> 'attempt')::int
     from (select public.start_recognition_run('f3000000-0000-4000-8000-000000000005', null) as j) s $$,
  $$ values ('started'::text, 2) $$,
  'The sweeper restarts the queued run without a second run row'
);

reset role;
update public.recognition_runs set lease_expires_at = now() - interval '1 second'
where id = 'f4000000-0000-4000-8000-000000000005';
set local role service_role;

select results_eq(
  $$ select j ->> 'action', (j ->> 'attempt')::int
     from public.resume_stale_recognition_runs(now(), 50, 'd0000000-0000-4000-8000-000000000001') j
     where j ->> 'note_id' = 'f3000000-0000-4000-8000-000000000005' $$,
  $$ values ('restart'::text, 3) $$,
  'The second expiry re-queues as attempt 3'
);
select is(
  (select public.start_recognition_run('f3000000-0000-4000-8000-000000000005', null) ->> 'outcome'),
  'started',
  'Attempt 3 starts'
);

reset role;
update public.recognition_runs set lease_expires_at = now() - interval '1 second'
where id = 'f4000000-0000-4000-8000-000000000005';
set local role service_role;

select results_eq(
  $$ select j ->> 'action', (j ->> 'attempt')::int
     from public.resume_stale_recognition_runs(now(), 50, 'd0000000-0000-4000-8000-000000000001') j
     where j ->> 'note_id' = 'f3000000-0000-4000-8000-000000000005' $$,
  $$ values ('failed'::text, 3) $$,
  'After the third attempt the sweeper fails the run'
);
select results_eq(
  $$ select r.status, r.failure_reason, (select n.status from public.notes n where n.id = r.note_id),
            (select a.payload ->> 'reason' from public.audit_events a
             where a.note_id = r.note_id and a.event_type = 'extraction_failed'),
            (select f.kind from public.feed_items f where f.note_id = r.note_id and f.kind = 'event_unreadable')
     from public.recognition_runs r where r.id = 'f4000000-0000-4000-8000-000000000005' $$,
  $$ values ('failed'::text, 'lease_expired'::text, 'extraction_failed'::text,
             'lease_expired'::text, 'event_unreadable'::text) $$,
  'The failed run is audited and shown as unreadable with a retry'
);

-- Takeover of an expired lease by a Member (note 6).
select is(
  (select public.start_recognition_run('f3000000-0000-4000-8000-000000000006',
     'd1000000-0000-4000-8000-000000000002') ->> 'outcome'),
  'started',
  'Note 6 run started'
);
reset role;
update public.recognition_runs set lease_expires_at = now() - interval '1 second'
where id = 'f4000000-0000-4000-8000-000000000006';
set local role service_role;
select results_eq(
  $$ select j ->> 'outcome', (j ->> 'attempt')::int, j ->> 'run_id'
     from (select public.start_recognition_run('f3000000-0000-4000-8000-000000000006',
             'd1000000-0000-4000-8000-000000000001') as j) s $$,
  $$ values ('started'::text, 2, 'f4000000-0000-4000-8000-000000000006'::text) $$,
  'A start over an expired lease takes the run over as attempt 2'
);

-- A queued run that never started (note 8, other household).
select is(
  (select count(*)::int from public.resume_stale_recognition_runs(now(), 50,
     'e0000000-0000-4000-8000-000000000021')),
  0,
  'A freshly queued run is not stale'
);
select results_eq(
  $$ select j ->> 'action', (j ->> 'attempt')::int, j ->> 'household_id'
     from public.resume_stale_recognition_runs(now() + interval '10 minutes', 50,
       'e0000000-0000-4000-8000-000000000021') j $$,
  $$ values ('restart'::text, 1, 'e0000000-0000-4000-8000-000000000021'::text) $$,
  'A run queued for over 5 minutes is returned for restart, scoped to one household'
);
select results_eq(
  $$ select status, attempt from public.recognition_runs where id = 'f4000000-0000-4000-8000-000000000008' $$,
  $$ values ('queued'::text, 1) $$,
  'Returning a queued run does not change it'
);
select throws_ok(
  $$ select public.resume_stale_recognition_runs(now(), 0) $$,
  'P0001', 'invalid_input',
  'A limit of zero is refused'
);

-- ---------------------------------------------------------------------------
-- Privacy: no note text, titles, names, or questions in audit payloads or feed params
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.audit_events
   where note_id in (select id from public.notes where id::text like 'f3000000-0000-4000-8000-00000000000%')
     and event_type like 'extraction%'
     and payload::text ~* '(clinic|glasses|medicine|misa|pharmacy|secret note text|cleaner|aunt|receipt|driver|family member)'),
  0,
  'Extraction audit payloads hold no titles, names, questions, or note text'
);
select is(
  (select count(*)::int from public.feed_items
   where note_id in (select id from public.notes where id::text like 'f3000000-0000-4000-8000-00000000000%')
     and params::text ~* '(clinic|glasses|medicine|misa|pharmacy|secret note text|cleaner|aunt|receipt|driver|family member)'),
  0,
  'Feed params hold no titles, names, questions, or note text'
);

-- ---------------------------------------------------------------------------
-- Privileges: service role only
-- ---------------------------------------------------------------------------
reset role;
select ok(
  not has_function_privilege('anon', 'public.start_recognition_run(uuid, uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.start_recognition_run(uuid, uuid, integer)', 'execute')
  and not has_function_privilege('anon', 'public.save_care_chain_draft(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.save_care_chain_draft(uuid, jsonb)', 'execute'),
  'Browser roles cannot execute start_recognition_run or save_care_chain_draft'
);
select ok(
  not has_function_privilege('anon', 'public.fail_recognition_run(uuid, text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.fail_recognition_run(uuid, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.resume_stale_recognition_runs(timestamptz, integer, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.resume_stale_recognition_runs(timestamptz, integer, uuid)', 'execute'),
  'Browser roles cannot execute fail_recognition_run or resume_stale_recognition_runs'
);
select ok(
  has_function_privilege('service_role', 'public.start_recognition_run(uuid, uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'public.save_care_chain_draft(uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.fail_recognition_run(uuid, text, boolean)', 'execute')
  and has_function_privilege('service_role', 'public.resume_stale_recognition_runs(timestamptz, integer, uuid)', 'execute'),
  'The service role can execute all four functions'
);
select ok(
  not has_function_privilege('authenticated', 'private.fail_run_locked(public.recognition_runs, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'private.usable_draft_id(uuid)', 'execute'),
  'Browser roles cannot execute the private helpers'
);

set local role authenticated;
select throws_ok(
  $$ select public.start_recognition_run('f3000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000001') $$,
  '42501', null,
  'A signed-in browser session cannot call start_recognition_run'
);
set local role anon;
select throws_ok(
  $$ select public.save_care_chain_draft('f4000000-0000-4000-8000-000000000001', '{}'::jsonb) $$,
  '42501', null,
  'An anonymous session cannot call save_care_chain_draft'
);
reset role;

select * from finish();

rollback;
