-- Family shared care, migration 2: tables, RLS, and the private evidence bucket.
--
-- Additive only: new tables, indexes, policies, and one new Storage bucket.
-- No existing row is read or rewritten.
--
-- Access model (same as the Phase 1 row-level security migration):
--   * anon: no access to any table below.
--   * authenticated: SELECT only, and only for households where the user is an
--     active member. No client insert, update, or delete.
--   * service_role: full access (server code and the Action_Guard functions).
--   * recognition_runs, step_escalations, household_sweeps: service role only.
--
-- Same-household composite foreign keys keep every row inside one household.
-- Free text (explanations, evidence text, answers) lives only in these tables,
-- never in audit payloads (Requirement 15.3).

-- ---------------------------------------------------------------------------
-- care_requests: Assignment, Handover, and Backup_Request (Requirements 5.9, 8.3)
-- ---------------------------------------------------------------------------
create table public.care_requests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  care_chain_id uuid not null,
  care_step_id uuid not null,
  kind text not null,
  helper_role text,
  from_member_id uuid not null,
  to_member_id uuid not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  expiry_rule text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint care_requests_kind_valid check (kind in ('assignment', 'handover', 'backup')),
  constraint care_requests_helper_role_valid check (
    helper_role is null or helper_role in ('owner', 'driver', 'companion')
  ),
  -- Assignment is always for the Owner role; Handover names the role; Backup has none.
  constraint care_requests_helper_role_matches_kind check (
    (kind = 'assignment' and helper_role = 'owner')
    or (kind = 'handover' and helper_role is not null)
    or (kind = 'backup' and helper_role is null)
  ),
  constraint care_requests_status_valid check (
    status in ('pending', 'accepted', 'declined', 'expired')
  ),
  constraint care_requests_expiry_rule_valid check (expiry_rule in ('task_due', '24h')),
  constraint care_requests_from_differs_to check (from_member_id <> to_member_id),
  constraint care_requests_resolved_together check (
    (status = 'pending') = (resolved_at is null)
    and (resolved_by is null or resolved_at is not null)
  ),
  constraint care_requests_chain_same_household
    foreign key (care_chain_id, household_id) references public.care_chains (id, household_id),
  constraint care_requests_step_same_chain
    foreign key (care_step_id, care_chain_id) references public.care_steps (id, care_chain_id),
  constraint care_requests_from_same_household
    foreign key (from_member_id, household_id) references public.household_members (id, household_id),
  constraint care_requests_to_same_household
    foreign key (to_member_id, household_id) references public.household_members (id, household_id),
  constraint care_requests_resolved_by_same_household
    foreign key (resolved_by, household_id) references public.household_members (id, household_id)
);

-- One pending request per Part, kind, and Helper_Role.
create unique index care_requests_one_pending_idx
  on public.care_requests (care_step_id, kind, coalesce(helper_role, '-'))
  where status = 'pending';

-- Sweeper: find pending requests that have expired, per household.
create index care_requests_sweeper_idx
  on public.care_requests (household_id, status, expires_at);
create index care_requests_to_member_idx on public.care_requests (to_member_id, status);
create index care_requests_step_idx on public.care_requests (care_step_id);

-- ---------------------------------------------------------------------------
-- part_evidence (Requirements 11.2, 15.3)
-- ---------------------------------------------------------------------------
create table public.part_evidence (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  care_chain_id uuid not null,
  care_step_id uuid not null,
  -- One of the Part's evidence_required entries, or 'other'.
  label text not null,
  kind text not null,
  -- Private bucket `evidence`: {household}/{step}/{epoch_ms}-evidence.{ext}
  storage_path text,
  text_body text,
  added_by uuid not null,
  created_at timestamptz not null default now(),
  constraint part_evidence_label_valid check (length(btrim(label)) between 1 and 200),
  constraint part_evidence_kind_valid check (kind in ('photo', 'file', 'text')),
  constraint part_evidence_content_matches_kind check (
    (kind in ('photo', 'file') and storage_path is not null and text_body is null)
    or (kind = 'text' and text_body is not null and storage_path is null)
  ),
  constraint part_evidence_text_length check (
    text_body is null or length(btrim(text_body)) between 1 and 2000
  ),
  constraint part_evidence_storage_path_format check (
    storage_path is null
    or (
      storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{13}-evidence\.(jpg|png|webp|pdf)$'
      and starts_with(storage_path, household_id::text || '/' || care_step_id::text || '/')
    )
  ),
  constraint part_evidence_storage_path_unique unique (storage_path),
  constraint part_evidence_id_step_unique unique (id, care_step_id),
  constraint part_evidence_chain_same_household
    foreign key (care_chain_id, household_id) references public.care_chains (id, household_id),
  constraint part_evidence_step_same_chain
    foreign key (care_step_id, care_chain_id) references public.care_steps (id, care_chain_id),
  constraint part_evidence_added_by_same_household
    foreign key (added_by, household_id) references public.household_members (id, household_id)
);

create index part_evidence_step_created_idx on public.part_evidence (care_step_id, created_at);
create index part_evidence_household_idx on public.part_evidence (household_id);

-- ---------------------------------------------------------------------------
-- part_missing_details (Requirements 10.x, 12.4)
-- ---------------------------------------------------------------------------
create table public.part_missing_details (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  care_chain_id uuid not null,
  care_step_id uuid not null,
  kind text not null,
  -- Dictionary key, or 'ai_question' when the question text comes from ai&.
  question_code text not null,
  -- Shown only in the Event_View; never copied to the feed, audit payloads, or logs.
  ai_question text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  answer text,
  constraint part_missing_details_kind_valid check (
    kind in ('date', 'time', 'location', 'person', 'document', 'amount', 'contact')
  ),
  constraint part_missing_details_question_code_format check (question_code ~ '^[a-z][a-z0-9_]{0,59}$'),
  constraint part_missing_details_ai_question_length check (
    ai_question is null or length(ai_question) between 1 and 500
  ),
  constraint part_missing_details_ai_question_matches_code check (
    ai_question is null or question_code = 'ai_question'
  ),
  constraint part_missing_details_answer_length check (
    answer is null or length(btrim(answer)) between 1 and 500
  ),
  constraint part_missing_details_resolved_together check (
    (resolved_at is null) = (resolved_by is null)
    and (answer is null or resolved_at is not null)
  ),
  constraint part_missing_details_chain_same_household
    foreign key (care_chain_id, household_id) references public.care_chains (id, household_id),
  constraint part_missing_details_step_same_chain
    foreign key (care_step_id, care_chain_id) references public.care_steps (id, care_chain_id),
  constraint part_missing_details_resolved_by_same_household
    foreign key (resolved_by, household_id) references public.household_members (id, household_id)
);

create index part_missing_details_step_idx
  on public.part_missing_details (care_step_id, resolved_at);
create index part_missing_details_household_idx on public.part_missing_details (household_id);

-- ---------------------------------------------------------------------------
-- part_resubmissions (Requirements 9.17 to 9.19)
-- ---------------------------------------------------------------------------
create table public.part_resubmissions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  care_chain_id uuid not null,
  care_step_id uuid not null,
  submitted_by uuid not null,
  explanation text,
  evidence_ids uuid[] not null default '{}',
  plan_changed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint part_resubmissions_explanation_length check (
    explanation is null or length(btrim(explanation)) between 1 and 1000
  ),
  -- A resubmission must carry something: words, new Evidence, or a changed plan.
  constraint part_resubmissions_has_content check (
    explanation is not null
    or cardinality(evidence_ids) > 0
    or plan_changed
  ),
  constraint part_resubmissions_chain_same_household
    foreign key (care_chain_id, household_id) references public.care_chains (id, household_id),
  constraint part_resubmissions_step_same_chain
    foreign key (care_step_id, care_chain_id) references public.care_steps (id, care_chain_id),
  constraint part_resubmissions_submitted_by_same_household
    foreign key (submitted_by, household_id) references public.household_members (id, household_id)
);

create index part_resubmissions_step_created_idx
  on public.part_resubmissions (care_step_id, created_at);
create index part_resubmissions_household_idx on public.part_resubmissions (household_id);

-- ---------------------------------------------------------------------------
-- feed_items: Family_Feed entries and In_App_Reminders (Requirements 4.5, 19.2)
-- ---------------------------------------------------------------------------
create table public.feed_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  note_id uuid,
  care_chain_id uuid,
  care_step_id uuid,
  kind text not null,
  actor_member_id uuid,
  -- Set: an In_App_Reminder visible only to this Member.
  recipient_member_id uuid,
  -- Codes and IDs only (role, request kind, deadline kind). Never free text.
  params jsonb not null default '{}',
  audit_event_id uuid not null references public.audit_events (id),
  seen_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint feed_items_kind_format check (kind ~ '^[a-z][a-z0-9_]{0,59}$'),
  constraint feed_items_params_is_object check (jsonb_typeof(params) = 'object'),
  constraint feed_items_step_requires_chain check (care_step_id is null or care_chain_id is not null),
  constraint feed_items_seen_only_for_reminders check (seen_at is null or recipient_member_id is not null),
  constraint feed_items_note_same_household
    foreign key (note_id, household_id) references public.notes (id, household_id),
  constraint feed_items_chain_same_household
    foreign key (care_chain_id, household_id) references public.care_chains (id, household_id),
  constraint feed_items_step_same_chain
    foreign key (care_step_id, care_chain_id) references public.care_steps (id, care_chain_id),
  constraint feed_items_actor_same_household
    foreign key (actor_member_id, household_id) references public.household_members (id, household_id),
  constraint feed_items_recipient_same_household
    foreign key (recipient_member_id, household_id) references public.household_members (id, household_id)
);

create index feed_items_household_created_idx on public.feed_items (household_id, created_at desc);
create index feed_items_recipient_idx
  on public.feed_items (recipient_member_id, seen_at, created_at desc)
  where recipient_member_id is not null;
create index feed_items_note_idx on public.feed_items (note_id);
create index feed_items_care_step_idx on public.feed_items (care_step_id);
create index feed_items_audit_event_idx on public.feed_items (audit_event_id);

-- ---------------------------------------------------------------------------
-- member_feed_state: per-Member "seen up to" marker (Requirement 4.3)
-- ---------------------------------------------------------------------------
create table public.member_feed_state (
  member_id uuid primary key,
  household_id uuid not null references public.households (id),
  last_seen_at timestamptz not null default now(),
  constraint member_feed_state_member_same_household
    foreign key (member_id, household_id) references public.household_members (id, household_id)
);

create index member_feed_state_household_idx on public.member_feed_state (household_id);

-- ---------------------------------------------------------------------------
-- recognition_runs: server-side recognition jobs (Requirement 2.13)
-- ---------------------------------------------------------------------------
create table public.recognition_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  note_id uuid not null,
  status text not null default 'queued',
  attempt integer not null default 1,
  lease_expires_at timestamptz,
  -- Auth user who started the run; null when the sweeper started it.
  started_by uuid references auth.users (id),
  care_chain_id uuid,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recognition_runs_status_valid check (
    status in ('queued', 'running', 'succeeded', 'failed', 'superseded')
  ),
  constraint recognition_runs_attempt_positive check (attempt >= 1),
  constraint recognition_runs_failure_reason_format check (
    failure_reason is null or failure_reason ~ '^[a-z][a-z0-9_]{0,39}$'
  ),
  constraint recognition_runs_note_same_household
    foreign key (note_id, household_id) references public.notes (id, household_id),
  constraint recognition_runs_chain_same_household
    foreign key (care_chain_id, household_id) references public.care_chains (id, household_id)
);

-- At most one active run per note.
create unique index recognition_runs_one_active_idx
  on public.recognition_runs (note_id)
  where status in ('queued', 'running');

-- Sweeper: find running runs whose lease has expired.
create index recognition_runs_lease_idx
  on public.recognition_runs (status, lease_expires_at)
  where status in ('queued', 'running');
create index recognition_runs_household_idx on public.recognition_runs (household_id);
create index recognition_runs_note_idx on public.recognition_runs (note_id, created_at);

create trigger recognition_runs_set_updated_at
  before update on public.recognition_runs
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- step_escalations: one escalation per deadline value (Requirement 12.3)
-- ---------------------------------------------------------------------------
create table public.step_escalations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  care_chain_id uuid not null,
  care_step_id uuid not null,
  deadline_kind text not null,
  deadline_at timestamptz not null,
  audit_event_id uuid not null references public.audit_events (id),
  created_at timestamptz not null default now(),
  constraint step_escalations_deadline_kind_valid check (deadline_kind in ('respond_by', 'task_due')),
  constraint step_escalations_once_per_deadline unique (care_step_id, deadline_kind, deadline_at),
  constraint step_escalations_chain_same_household
    foreign key (care_chain_id, household_id) references public.care_chains (id, household_id),
  constraint step_escalations_step_same_chain
    foreign key (care_step_id, care_chain_id) references public.care_steps (id, care_chain_id)
);

create index step_escalations_household_idx on public.step_escalations (household_id);
create index step_escalations_audit_event_idx on public.step_escalations (audit_event_id);

-- ---------------------------------------------------------------------------
-- household_sweeps: throttle for the on-open sweep
-- ---------------------------------------------------------------------------
create table public.household_sweeps (
  household_id uuid primary key references public.households (id),
  last_run_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Table privileges (defense in depth alongside RLS)
-- ---------------------------------------------------------------------------
revoke all on table
  public.care_requests,
  public.part_evidence,
  public.part_missing_details,
  public.part_resubmissions,
  public.feed_items,
  public.member_feed_state,
  public.recognition_runs,
  public.step_escalations,
  public.household_sweeps
from anon, authenticated;

-- Members may read these. Writes happen only through service-role functions.
grant select on table
  public.care_requests,
  public.part_evidence,
  public.part_missing_details,
  public.part_resubmissions,
  public.feed_items,
  public.member_feed_state
to authenticated;

grant all on table
  public.care_requests,
  public.part_evidence,
  public.part_missing_details,
  public.part_resubmissions,
  public.feed_items,
  public.member_feed_state,
  public.recognition_runs,
  public.step_escalations,
  public.household_sweeps
to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.care_requests enable row level security;
alter table public.part_evidence enable row level security;
alter table public.part_missing_details enable row level security;
alter table public.part_resubmissions enable row level security;
alter table public.feed_items enable row level security;
alter table public.member_feed_state enable row level security;
-- Service role only: RLS on, no policy for any client role, and no grants.
alter table public.recognition_runs enable row level security;
alter table public.step_escalations enable row level security;
alter table public.household_sweeps enable row level security;

create policy "Members can view household care requests"
  on public.care_requests
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));

create policy "Members can view household part evidence"
  on public.part_evidence
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));

create policy "Members can view household missing details"
  on public.part_missing_details
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));

create policy "Members can view household resubmissions"
  on public.part_resubmissions
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));

-- Household items are visible to every member. A reminder (recipient set) is
-- visible only to the Member it is addressed to.
create policy "Members can view household feed items and their own reminders"
  on public.feed_items
  for select
  to authenticated
  using (
    household_id in (select private.current_user_household_ids())
    and (
      recipient_member_id is null
      or recipient_member_id in (
        select m.id
        from public.household_members m
        where m.user_id = (select auth.uid())
          and m.is_active
      )
    )
  );

create policy "Members can view their own feed state"
  on public.member_feed_state
  for select
  to authenticated
  using (
    household_id in (select private.current_user_household_ids())
    and member_id in (
      select m.id
      from public.household_members m
      where m.user_id = (select auth.uid())
        and m.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- Storage bucket: private evidence (photos and files, 10 MB)
-- ---------------------------------------------------------------------------
-- Like `notes`: no Storage policies for anon or authenticated, so browser
-- roles cannot list, read, upload, or delete. Server code uses the service role.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.feed_items is
  'Family_Feed entries. Rows with recipient_member_id set are In_App_Reminders, visible only to that Member.';
comment on table public.recognition_runs is
  'Server-only recognition jobs. Not visible to browser roles.';
comment on table public.step_escalations is
  'Server-only ledger: one escalation per Part, deadline kind, and deadline value.';
comment on table public.household_sweeps is
  'Server-only throttle for the on-open sweep.';
