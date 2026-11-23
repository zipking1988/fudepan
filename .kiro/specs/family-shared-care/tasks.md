# Implementation Plan: Family Shared Care

## Overview

This plan implements `design.md` in TypeScript (Next.js App Router, Supabase, Vitest, fast-check, pgTAP). Each task builds on the previous one, and the app keeps working after every task.

Order: additive migrations, then the pure rule module and reference model, then the SQL Action_Guard functions with pgTAP tests, then the service layer and the rerouted old `/care` actions, then recognition, then the read layer and the new `/family` routes, then Japanese and the language setting, then escalation, then the Requirement 20 end-to-end test. Removing the old pages is a final, separate, optional task.

Constraints for every task:

- Migrations are additive only: new tables, nullable columns, columns with constant defaults, constraints that existing rows already satisfy, indexes, and functions (`create or replace` only for `complete_note_upload`, `private.can_upload_notes`, `save_appointment_clarification`, and `private.assert_care_step_owners_in_household`). Never reset the database and never rewrite existing QA rows.
- Do not commit, push, or deploy.
- Never log raw note content, titles, names, amounts, free text, or image data. Logs go through `src/lib/log.ts` and its allow-list only.
- AI output never assigns people. No Claim, Owner, Helper, Backup_Owner, Assignment, or Handover is ever created from a Suggested_Role, a Person_To_Ask, or any other ai& output.
- ai& is called only from server-only code. `AIAND_API_KEY` and the service-role key stay in `server-only` modules.
- The defaults marked "Default pending confirmation" in the design (D-1 to D-7) are implemented as written, but each one lives in a single named constant or rule (TypeScript in `src/lib/care/rules/defaults.ts`, SQL in one private helper function) so it can be changed in one place.
- Property-based tests use fast-check with at least 100 runs (`fc.assert(prop, { numRuns: 100 })`), live in their own test file, and carry the tag comment `// Feature: family-shared-care, Property {n}: {title}`.

## Tasks

- [x] 1. Add the `care_steps`, `audit_events`, and `household_members` columns
  - [x] 1.1 Write migration `supabase/migrations/20261210000000_shared_care_columns.sql`
    - `care_steps`: `approval_state` (nullable, value check, two consistency checks with `approval_required`), `approval_decided_by`, `approval_decided_at`, `plan_version int not null default 0`, `rejected_at_plan_version`, `driver_id`, `companion_id`, `respond_by_*` and `task_due_*` groups (all-null-or-all-set checks, provenance check, `set_by` required when `human_confirmed`), `person_to_ask`, `suggested_role`, `required_amount_minor`, `amount_currency`
    - `audit_events.note_id` with composite FK `(note_id, household_id) → notes(id, household_id)` and index `(note_id, created_at)`
    - `household_members.ui_language` with check `in ('en','ja')`
    - `create or replace` `private.assert_care_step_owners_in_household` to also check `driver_id` and `companion_id`, and extend its trigger to fire on those columns
    - Leave `due_at` and `escalation_at` untouched (legacy, read-only)
    - _Requirements: 3.6, 6.3, 6.4, 9.8, 9.11, 10.6, 10.7, 12.6, 12.7, 15.7, 17.7, 18.2, 18.6_
  - [x] 1.2 Write pgTAP test `supabase/tests/database/shared_care_columns.test.sql`
    - Existing seed rows still satisfy every new constraint and keep `approval_state = null`
    - Check constraints reject inconsistent approval and time groups; cross-household `driver_id`, `companion_id`, and `audit_events.note_id` are rejected
    - _Requirements: 18.2, 18.6, 14.1_

- [x] 2. Add the shared-care tables, RLS, and the private `evidence` bucket
  - [x] 2.1 Write migration `supabase/migrations/20261210000100_shared_care_tables.sql`
    - `care_requests` (partial unique index on pending per step, kind, and role; sweeper index), `part_evidence`, `part_missing_details`, `part_resubmissions`, `feed_items`, `member_feed_state`, `recognition_runs` (partial unique index `(note_id) where status in ('queued','running')`), `step_escalations` (unique `(care_step_id, deadline_kind, deadline_at)`), `household_sweeps`
    - RLS select policies scoped to the member's households; `feed_items` reminders visible only to the addressed member; no client insert, update, or delete; `recognition_runs`, `step_escalations`, `household_sweeps` service role only
    - Private Storage bucket `evidence` with no client access
    - _Requirements: 4.5, 5.9, 8.3, 11.2, 12.3, 14.1, 14.4, 15.3, 18.2, 19.2, 2.13_
  - [x] 2.2 Write pgTAP test `supabase/tests/database/shared_care_tables.test.sql`
    - RLS isolation between two households on every new table; reminders hidden from other members; `anon` and `authenticated` cannot write; `audit_events` still refuses update and delete from client roles
    - _Requirements: 4.5, 14.1, 14.2, 14.4_
  - [x] 2.3 Regenerate `src/lib/supabase/database.types.ts` with `pnpm db:types` against the local database
    - _Requirements: 18.2_

- [x] 3. Build the pure approval rules
  - [x] 3.1 Set up the rule module
    - Add `fast-check` as a dev dependency
    - Create `src/lib/care/rules/types.ts` (`HelperRole`, `ApprovalState`, `ProgressStatus`, `PartSnapshot`, `ConfirmedTime`, `MemberSnapshot`, `Decision<T>`)
    - Create `src/lib/care/rules/refusals.ts` with the `RefusalCode` union and the code-to-message-key map from the design's refusal table (`part_not_found` and `request_not_found` share one message)
    - Create `src/lib/care/rules/defaults.ts` holding the pending defaults as named constants: `REQUEST_EXPIRY_HOURS = 24` (D-1), `REOPEN_AND_BACKUP_ROLES` (D-2), `ESCALATION_LEDGER_KEY` description (D-3), `COMPLETED_LABEL_KEY = "done"` (D-4), `HANDOVER_PAST_DUE_FALLBACK = "24h"` (D-7), `ALLOW_LEGACY_BACKUP_CLEAR = false` (D-6), `RELEASE_WINDOW_HOURS = 24` (A3)
    - _Requirements: 7.1, 8.10, 14.2, 16.2_
  - [x] 3.2 Implement `src/lib/care/rules/approval.ts`
    - `effectiveApprovalState` (legacy derivation), `nextApprovalStateOnChange` (people and Key_Fact changes reset `approved` on High_Risk_Parts, `rejected` stays `rejected`, Progress_Status changes never change the state), `decideApproval` (active Primary_Caregiver only, Self_Approval only when the Owner is the only active Primary_Caregiver, `resubmission_required` for `rejected`, `approval_not_required`), `canResubmit` (Owner only, explanation or new Evidence or `plan_version > rejected_at_plan_version`)
    - `isHighRiskPart` lives here or in `claims.ts` and is exported once
    - _Requirements: 9.2, 9.5, 9.6, 9.7, 9.8, 9.9, 9.14, 9.16, 9.17, 9.18, 9.19, 9.21, 9.22, 18.6, 18.7_
  - [ ]* 3.3 Write property test for legacy approval derivation
    - **Property 29: Legacy approval derivation**
    - **Validates: Requirements 18.6, 18.7**
  - [ ]* 3.4 Write property test for approval transitions on changes
    - **Property 4: Approval transitions on changes**
    - **Validates: Requirements 5.5, 8.7, 9.9, 9.21, 9.22, 9.23, 9.24, 21.6, 18.7**
  - [ ]* 3.5 Write property test for approval independence from progress
    - **Property 5: Approval_State is independent of Progress_Status**
    - **Validates: Requirements 9.8, 11.3, 12.9, 12.13**
  - [ ]* 3.6 Write property test for approval authorization
    - **Property 6: Approval authorization**
    - **Validates: Requirements 9.2, 9.5, 9.6, 9.7, 9.14, 9.16, 20.4, 20.7**
  - [ ]* 3.7 Write property test for resubmission
    - **Property 7: Resubmission needs content and comes from the Owner**
    - **Validates: Requirements 9.17, 9.18, 9.19**

- [x] 4. Build the pure claim, request, and completion rules
  - [x] 4.1 Implement `src/lib/care/rules/claims.ts`
    - `helperRolesOffered` (Driver and Companion only for `appointment` and `transport`), `decideClaim` (Care_Recipient refused, first holder wins with `already_claimed` naming the holder, `role_not_offered`, `part_closed`, approval transition through `nextApprovalStateOnChange`), `decideRelease` (blocked for High_Risk_Parts with a `human_confirmed` Task_Due_Time within `RELEASE_WINDOW_HOURS` or overdue)
    - _Requirements: 5.1, 5.4, 5.5, 5.13, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 7.1, 7.2, 9.22, 21.2, 21.4_
  - [ ]* 4.2 Write property test for claiming
    - **Property 3: Claiming an unheld role succeeds and a held role is refused**
    - **Validates: Requirements 5.1, 5.4, 6.2**
  - [ ]* 4.3 Write property test for the release rule
    - **Property 9: Release rule**
    - **Validates: Requirements 7.1, 7.2, 21.4**
  - [ ]* 4.4 Write property test for offered helper roles
    - **Property 26: Helper roles offered**
    - **Validates: Requirements 6.1, 6.7**
  - [x] 4.5 Implement `src/lib/care/rules/requests.ts`
    - `handoverExpiry` (confirmed Task_Due_Time when later than the request time, else 24 hours, D-7 isolated in `defaults.ts`), `requestExpiry` for Assignment and Backup_Request (D-1), `eligibleReceivers` (active, non-Care_Recipient, same household, not the requester), `decideRequestResponse` (accept moves only the requested role, decline changes no holder, accept at or after expiry returns the committed `expired` outcome, holder-changed closes as declined, approval transition on accept)
    - _Requirements: 5.10, 5.11, 5.15, 5.16, 8.2, 8.4, 8.5, 8.6, 8.9, 8.10, 8.11, 8.12, 21.6_
  - [ ]* 4.6 Write property test for request expiry
    - **Property 11: Request expiry time**
    - **Validates: Requirements 8.10**
  - [ ]* 4.7 Write property test for eligible receivers
    - **Property 12: Eligible receivers**
    - **Validates: Requirements 8.2**
  - [x] 4.8 Implement `src/lib/care/rules/completion.ts`
    - `decideCompletion`: `not_owner` (with Owner name param), `approval_pending` when approval is required and not `approved`, `evidence_required` with the exact missing labels, else `completed`; Progress_Status `in_progress`, `evidence_required`, and `escalated` do not change the outcome
    - _Requirements: 6.6, 9.3, 11.1, 11.3, 11.6, 11.7_
  - [ ]* 4.9 Write property test for the completion decision
    - **Property 8: Completion decision**
    - **Validates: Requirements 6.6, 9.3, 11.1, 11.3, 11.6, 11.7, 20.8**

- [x] 5. Build labels, missing details, and the escalation oracle
  - [x] 5.1 Implement `src/lib/care/rules/labels.ts` and fix `src/lib/care/risk.ts`
    - `riskLabelKey` and `approvalLabelKey` ("Done" checked first through `COMPLETED_LABEL_KEY` (D-4), "Requires confirmation" only for `pending`, "Confirmed", "Not approved", nothing for `not_required`)
    - Change `RISK_LABELS.high` from "Requires confirmation" to "High risk" and update any existing test that asserted the old text
    - _Requirements: 9.1, 9.10, 9.11, 9.12, 17.2_
  - [x] 5.2 Implement `src/lib/care/rules/missing-details.ts`
    - `deriveMissingDetails`: stored unresolved details plus derived ones ("No driver yet" for transport without Driver, appointment without location or time shows "Needs details", High_Risk_Part without any `human_confirmed` time shows "No deadline yet"); each has a question key and a reason key
    - _Requirements: 6.5, 10.1, 10.5, 12.4_
  - [x] 5.3 Implement `src/lib/care/rules/escalation.ts`
    - `escalationCandidates(parts, ledger, now)`: respond-by and task-due plans per the design, `human_confirmed` values only, never `due_at` or `escalation_at`, skips Closed_Parts, low-risk Parts get no reminders, recipients per deadline kind, ledger key per D-3
    - _Requirements: 8.13, 12.1, 12.2, 12.3, 12.6, 12.7, 12.8, 12.10, 12.11, 12.12, 12.14_
  - [ ]* 5.4 Write property test for the escalation plan
    - **Property 16: Escalation plan**
    - **Validates: Requirements 8.13, 12.1, 12.2, 12.6, 12.7, 12.8, 12.10, 12.11, 12.12, 12.14**

- [x] 6. Build the in-memory reference model
  - [x] 6.1 Implement `src/lib/care/rules/model.ts`
    - In-memory household with Members, Parts, requests, audit log, feed, and reminders; each operation (claim, release, Assignment, Handover, Backup_Request, volunteer backup, respond, expire, approve, reject, resubmit, complete, fail, reopen, evidence, legacy owner change) calls the `decide*` functions and applies the same writes as the SQL functions, including one primary audit event, one Feed_Item, and one `reminder.sent` event per reminder
    - Shared fast-check generators in `src/lib/care/rules/arbitraries.ts` (households with 0, 1, 2+ active Primary_Caregivers, all roles and categories, legacy and stored states, times around `now`, operation sequences)
    - _Requirements: 4.2, 4.10, 15.1, 15.6, 19.3_
  - [ ]* 6.2 Write property test for single holders
    - **Property 1: At most one holder per Helper_Role**
    - **Validates: Requirements 6.3, 6.4, 5.4**
  - [ ]* 6.3 Write property test for holder changes
    - **Property 2: Holders change only by the holder's own act**
    - **Validates: Requirements 5.2, 5.9, 5.14, 8.3, 18.8, 21.1, 21.2, 21.5**
  - [ ]* 6.4 Write property test for the request lifecycle
    - **Property 10: Request lifecycle**
    - **Validates: Requirements 5.10, 5.11, 5.15, 5.16, 8.1, 8.4, 8.5, 8.6, 8.9, 8.11, 8.12, 20.5, 20.6**
  - [ ]* 6.5 Write property test for role-restricted actions
    - **Property 13: Role-restricted actions**
    - **Validates: Requirements 5.12, 5.13, 13.7, 12.13**
  - [ ]* 6.6 Write property test for household isolation in the model
    - **Property 14: Household isolation**
    - **Validates: Requirements 3.5, 4.5, 14.1, 14.2**
  - [ ]* 6.7 Write property test for audit and feed accounting
    - **Property 15: Audit and feed accounting**
    - **Validates: Requirements 4.2, 4.10, 5.6, 6.2, 7.3, 8.8, 9.2, 9.20, 15.1, 15.6, 19.3, 20.9**

- [x] 7. Checkpoint - Rule module complete
  - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:db` (migrations changed). Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement the Action_Guard SQL functions
  - All functions: `plpgsql`, `set search_path = ''`, execute revoked from `public`, `anon`, `authenticated`, granted to `service_role`; lock the `care_steps` row first, then any `care_requests` row; resolve the actor with `private.actor_member` at processing time; raise `P0001` with a refusal code except for the committed outcomes `expired` and `evidence_required`; audit payloads hold only IDs, codes, counts, ISO times, and zone names.
  - [x] 8.1 Write migration `supabase/migrations/20261210000200_shared_care_helpers.sql` and pgTAP test `shared_care_helpers.test.sql`
    - `private.actor_member`, `private.effective_approval_state`, `private.is_high_risk`, `private.apply_people_change`, `private.apply_key_fact_change`, `private.write_audit` (sets `note_id`, `clock_timestamp()`), `private.add_feed_item`, `private.add_reminder` (writes `reminder.sent` with `channel: 'in_app'`)
    - D-1 and D-7 expiry rules in one helper `private.request_expiry(kind, step, requested_at)`; D-2 roles in one helper `private.may_reopen_or_request_backup(actor, step)`
    - pgTAP: legacy derivation matches Requirement 18.6, reset only on approved High_Risk_Parts, rejected stays rejected, materialized state is stored
    - _Requirements: 9.9, 9.14, 9.21, 9.22, 9.24, 15.2, 15.7, 18.6, 18.7, 19.3_
  - [x] 8.2 Add `claim_part` and `release_part` to `supabase/migrations/20261210000300_shared_care_functions.sql` with pgTAP test `part_claims.test.sql`
    - pgTAP: first committed claim wins, `already_claimed`, `role_not_offered`, `recipient_read_only`, cross-household `part_not_found`, release blocked due soon, approval reset committed with the change, rollback leaves both absent
    - _Requirements: 5.1, 5.4, 5.5, 5.6, 5.13, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 9.22, 9.23, 14.2_
  - [x] 8.3 Add `request_assignment`, `request_handover`, `request_backup`, `volunteer_backup`, `respond_to_request`, and `expire_care_requests` to the same migration with pgTAP test `care_requests.test.sql`
    - pgTAP: holders unchanged while pending, accept moves only the requested role, decline sends a reminder to the requester, acceptance after `expires_at` commits the expired outcome even without a sweep, expiry touches no other request, `not_primary_caregiver` for Assignment, `receiver_not_eligible`, `request_pending`, approval reset on accepted Handover or Assignment
    - _Requirements: 5.7, 5.9, 5.10, 5.11, 5.12, 5.14, 5.15, 5.16, 5.17, 5.18, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 21.1, 21.5, 21.6_
  - [x] 8.4 Add `decide_approval` and `resubmit_part` to the same migration with pgTAP test `part_approval.test.sql`
    - pgTAP: non-primary refused, Owner refused with 2+ active Primary_Caregivers, Self_Approval marked in payload with one, demote a Primary_Caregiver then approve is refused (processing-time check), `resubmission_required`, `resubmission_empty`, explanation text stored only in `part_resubmissions`, Progress_Status untouched
    - _Requirements: 9.2, 9.5, 9.6, 9.7, 9.13, 9.14, 9.16, 9.17, 9.18, 9.19, 9.20_
  - [x] 8.5 Add `complete_part`, `report_part_failed`, `reopen_part`, and `record_evidence` to the same migration with pgTAP test `part_completion.test.sql`
    - pgTAP: `not_owner`, `approval_pending`, committed `evidence_required` outcome listing missing labels, completion from `escalated` or `evidence_required`, Reopen only by Owner or Primary_Caregiver, evidence text and path stored only in `part_evidence`
    - _Requirements: 9.3, 11.1, 11.2, 11.3, 11.4, 11.6, 11.7, 12.13, 15.3_
  - [x] 8.6 Add `confirm_part_time`, `save_part_amount`, `resolve_missing_detail`, `mark_feed_seen`, and `set_member_language` to the same migration with pgTAP test `part_details.test.sql`
    - pgTAP: `human_confirmed` provenance with zone and actor, invalid zone or out-of-range time refused, amount change resets an approved High_Risk_Part, answers stored only in `part_missing_details`, reminders get `seen_at`
    - _Requirements: 4.3, 9.9, 9.24, 10.3, 10.7, 17.7, 19.2_
  - [x] 8.7 Write pgTAP test `shared_care_grants_and_payloads.test.sql`
    - `anon` and `authenticated` cannot execute any new function; every new audit event type's payload keys are on the allow-list
    - _Requirements: 14.4, 15.3, 16.3_
  - [x] 8.8 Regenerate `src/lib/supabase/database.types.ts`
    - _Requirements: 18.2_

- [x] 9. Implement the Part action service
  - [x] 9.1 Implement `src/lib/care/part-actions.ts`
    - `createSupabasePartActionStore(admin, log)` calls each function by rpc and validates the JSON result with Zod; maps `P0001` messages to `RefusalCode`, unknown errors to `error`
    - `createPartActionService({ store, log })` parses input with Zod, runs the rule pre-check, calls the store, returns `{ ok: true, ... } | { ok: false, error: MessageKey, params }`
    - Add `step_id` and `request_id` to the `src/lib/log.ts` allow-list; log only `errorCode()` and allow-listed fields
    - _Requirements: 14.2, 16.1, 16.2_
  - [ ]* 9.2 Write property test for plain errors
    - **Property 33: Errors shown to Members are plain**
    - **Validates: Requirements 16.1, 16.2**
  - [ ]* 9.3 Write unit tests for `part-actions.ts`
    - Refusal mapping per code, committed outcomes, Zod field errors name the field
    - _Requirements: 10.3, 16.2_

- [x] 10. Reroute the old `/care` actions through the Action_Guard
  - [x] 10.1 Implement `src/lib/care/owner-assignment.ts`
    - Pure `translateOwnerAssignment(current, input, actor)`: self owner → claim, other owner → Assignment request, cleared owner → release, self backup → volunteer, other backup → Backup_Request, cleared backup → refusal unless `ALLOW_LEGACY_BACKUP_CLEAR` (D-6), unchanged → no call
    - _Requirements: 5.19, 18.5, 21.1, 21.2, 21.3, 21.4, 21.5_
  - [ ]* 10.2 Write property test for owner-assignment translation
    - **Property 30: Old owner-assignment translation**
    - **Validates: Requirements 5.19, 18.5, 21.1, 21.2, 21.3, 21.4, 21.5**
  - [x] 10.3 Rewrite `approveStep`, `assignStepOwner`, `completeStep`, and `addTextEvidence` in `src/app/(app)/care/actions.ts`
    - Keep names and signatures; call the part action service; remove direct `care_steps` updates and `audit_events` inserts; `completeStep` no longer checks `status = 'approved'`; `addTextEvidence` writes through `record_evidence(kind='text')`, so evidence text leaves the audit payload
    - _Requirements: 9.13, 11.8, 15.3, 18.5, 21.3_
  - [x] 10.4 Switch `src/lib/care/step-state.ts` and `chain-summary.ts` to `effectiveApprovalState`
    - Old pages show the same approval truth as the new ones; legacy `approved` status shows as "In progress"
    - _Requirements: 9.10, 18.3, 18.6_
  - [ ]* 10.5 Update unit tests in `src/lib/care/actions.test.ts`
    - With a mock store, the old actions call the service and never call `from('care_steps').update` or `from('audit_events').insert`
    - _Requirements: 18.5_

- [x] 11. Checkpoint - Guard enforced on old pages
  - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:db`. Ensure all tests pass, ask the user if questions arise.

- [x] 12. Rebuild recognition as a server job
  - [x] 12.1 Add replaced `complete_note_upload` and `private.can_upload_notes` to `supabase/migrations/20261210000400_recognition_functions.sql` with pgTAP test `recognition_upload.test.sql`
    - `can_upload_notes` allows every active Member including `care_recipient`; `complete_note_upload` also sets `audit_events.note_id`, writes Feed_Item `event_created`, and inserts a queued `recognition_runs` row in the same transaction
    - pgTAP: a Care_Recipient can reserve and complete an upload in their own household only; `note.uploaded` has `note_id` and no image data
    - _Requirements: 1.3, 1.4, 1.8, 4.8, 15.7_
  - [x] 12.2 Add `start_recognition_run`, `save_care_chain_draft`, `fail_recognition_run`, and `resume_stale_recognition_runs` to the same migration with pgTAP test `recognition_runs.test.sql`
    - `save_care_chain_draft` write order: lock note and run, return the existing chain if a Usable_Draft exists, insert chain, insert Parts with `audit_event_id = null` and no owners or times on appointment Parts, insert `part_missing_details`, insert `extraction.succeeded`, backfill `audit_event_id`, note → `pending_review`, run → `succeeded`, Feed_Item `event_ready`; refuse more than 50 steps
    - pgTAP: order and backfill, forced failure rolls back chain, Parts, and success event; second active run refused with `recognition_running`; lease expiry re-queues up to 3 attempts
    - _Requirements: 2.1, 2.3, 2.4, 2.6, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 5.3, 10.6_
  - [x] 12.3 Extend `src/lib/ai/schema.ts` and the prompt in `src/lib/ai/client.ts`
    - Optional `person_to_ask` per step and optional `step_index` and `kind` per ambiguity, so older outputs still parse; prompt asks for a professional-question Part for medical questions and separate Parts for shopping and medicine pickup
    - _Requirements: 2.9, 6.7, 10.4, 10.6_
  - [x] 12.4 Implement `src/lib/care/draft-rows.ts`
    - Pure mapping from a normalized draft to the `save_care_chain_draft` JSON: never sets holders, stores `suggested_role` and `person_to_ask` as text only, no times on appointment Parts, `approval_state` `pending` iff `approval_required`
    - _Requirements: 2.6, 2.8, 5.3, 10.6_
  - [ ]* 12.5 Write property test for draft rows
    - **Property 20: Draft rows never claim, guess times, or skip approval**
    - **Validates: Requirements 2.3, 2.6, 2.8, 5.3, 10.6**
  - [x] 12.6 Implement `src/lib/care/recognition.ts`
    - `createRecognizer({ store, ai, storage, log })` with `start` and `run` (never throws); reads the photo with the service role from `notes.image_path`; Zod parse, `validateCareChainDraft`, `normalizeCareChainDraft`; calls `save_care_chain_draft` or `fail_recognition_run` with a reason code; `AbortSignal.timeout` shorter than `maxDuration`; replaces `runExtraction`
    - _Requirements: 2.2, 2.3, 2.4, 2.11, 16.1_
  - [ ]* 12.7 Write property test for invalid ai& output
    - **Property 21: Invalid ai& output is never saved**
    - **Validates: Requirements 2.4, 2.11**
  - [ ]* 12.8 Write property test for one Usable_Draft per note
    - **Property 19: At most one Usable_Draft per note**
    - Model run in `pnpm test`; DB variant in the integration suite with rolled-back transactions
    - **Validates: Requirements 2.12, 2.13, 2.15**
  - [x] 12.9 Wire recognition with `after()`
    - `completeNoteUpload` in `src/app/(app)/notes/actions.ts` schedules `after(() => recognizer.run(runId))`; `triggerExtraction` uses `recognizer.start` and returns "Being read" while a run is active; create `src/lib/family/sweep.ts` `runHouseholdSweep(householdId)` throttled through `household_sweeps` that resumes stale runs; set `maxDuration = 60` on the capture and notes pages; regenerate database types
    - _Requirements: 1.3, 2.13, 2.14, 2.15_

- [x] 13. Checkpoint - Recognition job working
  - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:db`. Ensure all tests pass, ask the user if questions arise.

- [x] 14. Build the shared read layer
  - [x] 14.1 Create `src/lib/i18n/en.ts`, `src/lib/i18n/format.ts`, and `src/lib/i18n/messages.ts`
    - `const en = {...} as const`, `type Messages`; `formatInZone(instant, timeZone, lang)`; `getMessages(lang)` returning `en` until task 17; every new screen string and refusal message is a key here; plain language without "step", "chain", "extraction", or "status code"
    - _Requirements: 17.6, 16.2_
  - [x] 14.2 Implement `getSharedCareEvent(noteId)` in `src/lib/care/queries.ts` and pure `selectEventChain` in `src/lib/family/shared-care-event.ts`
    - Newest chain whose status is not `extraction_failed`; "Being read" or "Could not read this note" from note status; done when every Part is `completed` or `cancelled`; legacy owners shown as Owners; RLS client only
    - _Requirements: 3.1, 3.5, 4.9, 11.5, 18.3_
  - [ ]* 14.3 Write property test for event selection
    - **Property 27: One Shared_Care_Event from the newest Usable_Draft**
    - **Validates: Requirements 3.1, 4.9, 11.5**
  - [x] 14.4 Implement `src/lib/family/feed.ts`
    - `listFeed` (newest first, limit 50, one household), `renderFeedItem` from codes and display names, `partReference` with generic phrases for `medication`, `medical`, `payment`, `document`, "New" marker after `last_seen_at`, unseen reminder count, "Needs someone" derivation, "{name} has an in-app reminder" wording
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.10, 12.4, 12.10, 19.2, 19.4_
  - [ ]* 14.5 Write property test for feed ordering and counts
    - **Property 24: Feed ordering, new marker, and reminder count**
    - **Validates: Requirements 4.1, 4.3, 19.2**
  - [ ]* 14.6 Write property test for sensitive text
    - **Property 22: No sensitive text in feed text or audit payloads**
    - **Validates: Requirements 4.6, 15.3**
  - [ ]* 14.7 Write property test for missing details and "Needs someone"
    - **Property 25: Missing details and "Needs someone"**
    - **Validates: Requirements 4.4, 6.5, 10.1, 10.5, 12.4, 12.10**
  - [x] 14.8 Implement `src/lib/care/timeline.ts`
    - `getEventTimeline(noteId)` gathers by `note_id`, by legacy `payload->>'note_id'` where `note_id is null`, and by the note's chains; de-duplicates by `id`; orders `(created_at, id)` descending; Self_Approval flag exposed
    - _Requirements: 15.4, 15.5, 15.7, 15.8, 9.15, 20.10_
  - [ ]* 14.9 Write property test for timeline gathering
    - **Property 23: Timeline gathering**
    - **Validates: Requirements 15.4, 15.7, 15.8, 20.10**
  - [x] 14.10 Implement `src/lib/family/recipient-sentences.ts`
    - `sentenceForPart(part, dict)`: one plain sentence per Part with status in words, no confidence or codes
    - _Requirements: 13.2, 13.3, 13.6_

- [x] 15. Build the new `/family` routes
  - Pages are Server Components reading through the RLS client from `getSession()` inside `<Suspense>`; interactive parts are small Client Components; layouts render without horizontal scrolling at 360 px, use semantic HTML, labelled controls, visible focus, and `aria-live` for action results.
  - [x] 15.1 Create the `(family)` route group layout, navigation, and `error.tsx`
    - Family navigation shows the unseen reminder count in text; Care_Recipients get a layout with no navigation besides capture; error boundary shows a plain message and "Try again"
    - _Requirements: 13.1, 16.2, 17.1, 17.3, 18.1, 19.2_
  - [x] 15.2 Create `src/app/(family)/family/actions.ts` and the evidence upload service
    - Server Actions from the design table with Zod inputs, message keys translated by the Member's dictionary, `revalidatePath` for event, feed, and timeline; `confirmPartTime` converts local date, time, and zone with `zonedTimeToInstant`; `retryRecognition` uses `after()`; evidence `prepareEvidenceUpload`, `completeEvidenceUpload`, `addTextEvidence` follow the note upload pattern with the private `evidence` bucket
    - _Requirements: 2.15, 5.1, 5.7, 5.14, 5.17, 6.2, 7.1, 8.1, 8.4, 9.2, 9.17, 10.2, 10.7, 11.1, 11.2, 11.4, 12.13, 17.5_
  - [ ]* 15.3 Write property test for confirmed times
    - **Property 31: Confirmed times round-trip**
    - **Validates: Requirements 10.7**
  - [x] 15.4 Build the Capture_Screen at `/family/capture`
    - Camera input with `capture="environment"`, "Choose a photo instead" fallback, consent text naming ai& and "authorized household members" before confirming, client-side signature and size check with a "Take the photo again" message, file kept in state for "Try again", "Sent to your family. You're done." after the upload completes
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.9, 14.5, 17.4_
  - [ ]* 15.5 Write rendering tests for the Capture_Screen
    - Camera input, fallback, consent wording, success and failure states
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.9, 14.5_
  - [x] 15.6 Build the Family_Feed at `/family`
    - "Needs someone" section first, newest-first list with text "New" markers, "Being read" and "Could not read this note" states with retry and view-original actions, 30-second `router.refresh()` polling while visible with a polite live region, mark seen, on-open sweep through `runHouseholdSweep`; Care_Recipients get the Recipient_View instead
    - _Requirements: 2.5, 4.1, 4.3, 4.4, 4.7, 4.8, 4.9, 11.5, 12.4, 12.10_
  - [ ]* 15.7 Write rendering tests for the Family_Feed
    - Section order, "New" text, live region, failure actions
    - _Requirements: 2.5, 4.3, 4.4, 4.7_
  - [x] 15.8 Build the Event_View at `/family/events/[noteId]`
    - Part card in the design's order: title, Risk_Label, Approval_Label, Progress_Status words, Helpers or "Nobody yet", pending requests with expiry and zone, Missing_Detail questions with reasons and forms that keep input on error, three labelled times with zone or "Not set yet", Evidence required and attached, "if nobody responds" sentence, literal-date suggestions with quote and zone and a confirm button, Suggested_Role and "Ask {name}" as hints only; buttons from the rule module, disabled with a text reason when not allowed; backup prompt after claiming; release refusal offers "Hand this to someone"; link to the original photo through `/notes/[noteId]/image` with alt text
    - _Requirements: 2.7, 2.8, 3.2, 3.3, 3.4, 3.6, 5.7, 5.8, 6.1, 6.5, 7.4, 8.1, 9.1, 9.10, 9.11, 9.12, 10.1, 10.3, 10.4, 10.5, 12.4, 17.2, 17.4, 17.9_
  - [ ]* 15.9 Write property test for Part rendering
    - **Property 28: Part rendering is complete and plain**
    - Covers both `PartCard` markup and `sentenceForPart`
    - **Validates: Requirements 3.2, 3.4, 3.6, 13.2, 13.3, 13.6, 17.9**
  - [x] 15.10 Build the Recipient_View at `/family` (Care_Recipient branch) and `/family/me/[noteId]`
    - Body text at least `text-xl`, 48 px touch targets, capture as the only action, read-only sentences, original text as written; a Care_Recipient opening `/family/events/[noteId]` is redirected here
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 17.9_
  - [ ]* 15.11 Write rendering tests for the Recipient_View
    - One action, no forms, size classes, no codes or confidence values
    - _Requirements: 13.1, 13.4, 13.5, 13.6_
  - [x] 15.12 Build the Timeline at `/family/events/[noteId]/timeline`
    - Plain-language events newest first with acting Member and affected Part; "Self-approval" label in text; rejection and resubmission both shown
    - _Requirements: 9.15, 9.20, 15.4, 15.5_
  - [ ]* 15.13 Write rendering tests for the Timeline
    - Self-approval label, actor names, legacy event labels
    - _Requirements: 9.15, 15.5_

- [x] 16. Checkpoint - New flow in English
  - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`. Ensure all tests pass, ask the user if questions arise.

- [x] 17. Add Japanese and the member language setting
  - [x] 17.1 Create `src/lib/i18n/ja.ts` and `src/lib/i18n/language.ts`, and wire the language into pages and actions
    - `const ja: Messages` with every key (missing keys fail typecheck), Japanese labels from the design's label table; `resolveLanguage(member.ui_language, acceptLanguage)`; `getMessages` uses the resolved language for the Capture_Screen, Family_Feed, Event_View (including approval and Handover actions), Recipient_View, Timeline, and all error messages; recognized original text and AI titles are never translated; old pages stay English
    - _Requirements: 17.7, 17.8, 17.9, 17.11_
  - [ ]* 17.2 Write property test for language resolution
    - **Property 32: Language resolution**
    - **Validates: Requirements 17.7**
  - [ ]* 17.3 Write property test for labels
    - **Property 18: Labels**
    - Both `en` and `ja`; Japanese labels pairwise distinct
    - **Validates: Requirements 9.1, 9.10, 9.11, 9.12, 17.2, 17.11**
  - [x] 17.4 Build `/family/settings/language` and add the `setLanguage` action to `src/app/(family)/family/actions.ts`
    - Labelled radio group, calls `set_member_language`, announces the result
    - _Requirements: 17.4, 17.5, 17.7_
  - [ ]* 17.5 Write unit tests for the dictionaries
    - No string contains "step", "chain", "extraction", or "status code" (or Japanese equivalents); Japanese rendering of the capture, feed, approval, Handover, and error screens
    - _Requirements: 17.6, 17.8, 17.10_

- [x] 18. Move escalation to the database and add the sweeper triggers
  - [x] 18.1 Write migration `supabase/migrations/20261210000500_escalation_functions.sql` with pgTAP test `escalation_shared.test.sql`
    - `escalate_due_parts` (runs `expire_care_requests` first, `for update skip locked`, ledger insert `on conflict do nothing`, respond-by and task-due branches, reminders and Feed_Item naming who was notified, never reads `due_at` or `escalation_at`, never writes `approval_state`); replaced `save_appointment_clarification` adds `recipient_read_only`, `part_closed`, `apply_key_fact_change` for location and time, `note_id`, and Feed_Item
    - pgTAP: one escalation per deadline value, Closed_Parts and `failed` skipped, model-suggested times ignored, overdue Owner Handover expired then escalated with the requester as Owner, Key_Fact reset in the clarification function; regenerate database types
    - _Requirements: 8.13, 9.9, 9.24, 10.2, 12.1, 12.2, 12.3, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.14_
  - [x] 18.2 Update `src/lib/care/escalation.ts`, `src/lib/family/sweep.ts`, and `runEscalationCheck`
    - `detectAndMarkEscalated` keeps its name and calls `escalate_due_parts`; the household sweep also expires requests and escalates; `runEscalationCheck` in `src/app/(app)/care/actions.ts` goes through the sweep
    - _Requirements: 12.1, 12.2, 18.5_
  - [x] 18.3 Add the cron Route Handler `src/app/api/cron/sweep/route.ts`
    - Requires `Authorization: Bearer ${CRON_SECRET}` (401 without detail otherwise), sweeps all households; add the cron entry to `vercel.json` and `CRON_SECRET=` to `.env.example`
    - _Requirements: 2.14, 12.1, 12.2_
  - [ ]* 18.4 Write property test for escalation idempotency
    - **Property 17: Escalation is idempotent per deadline value**
    - Model run in `pnpm test`; DB variant in the integration suite
    - **Validates: Requirements 12.3, 12.14**
  - [ ]* 18.5 Write unit tests for the cron route
    - Missing or wrong secret returns 401; correct secret calls the sweep
    - _Requirements: 16.2_

- [x] 19. Checkpoint - Escalation and sweeper
  - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:db`. Ensure all tests pass, ask the user if questions arise.

- [x] 20. Write the Requirement 20 end-to-end test
  - Integration test in the `pnpm test:integration` suite against local Supabase with the ai& client mocked: Care_Recipient upload where the action returns before `after()` completes, Family_Member sees the same event in the feed, non-primary claim of a High_Risk_Part keeps `pending`, the same Member's approval is refused with no approval event, Handover request and acceptance keep `pending`, approval by a non-Owner Primary_Caregiver shows "Confirmed", Evidence and completion by the new Owner show "Done", and the Timeline lists all events in order with the acting Member or `ai`, including the note-linked `note.uploaded` and `extraction.attempted` events
  - Also run the DB variants of Properties 1, 2, 4, 6, 10, 13, 14, 15, 17, and 19 in this suite when their optional property tasks were implemented
  - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10_

- [x] 21. Final checkpoint - All gates pass
  - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:db`, and `pnpm test:integration`. Ensure all tests pass, ask the user if questions arise.

- [ ] 22. Remove the old `/notes` and `/care` pages (separate, later change)
  - [ ]* 22.1 Remove the old pages after the new flow passes all gates
    - Only after task 21 passes and the user confirms; keep `/notes/[noteId]/image` and any server code the new flow imports; re-run all gates
    - _Requirements: 18.4_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The pgTAP tests inside tasks 1, 2, 8, 12, and 18 and the end-to-end test in task 20 are required.
- Task 22 is optional and must be done as a separate change after the user confirms the new flow works.
- Each task references requirement clauses for traceability. Property tests validate the design's correctness properties; unit and pgTAP tests cover examples, edge cases, constraints, and grants.
- Layout at 360 px, keyboard operation, Japanese acceptance of the core flow (17.10), real-handwriting recognition quality (2.9, 6.7), and the absence of external sharing, payments, and messages (9.4, 14.3, 19.1) are checked outside automated tests, as stated in the design.
- Defaults pending confirmation: D-1 and D-7 in `defaults.ts` and `private.request_expiry`, D-2 in `defaults.ts` and `private.may_reopen_or_request_backup`, D-3 in the `step_escalations` unique key and `escalationCandidates`, D-4 in `COMPLETED_LABEL_KEY`, D-5 in the `audit_events.note_id` column (task 1.1), D-6 in `ALLOW_LEGACY_BACKUP_CLEAR`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2", "5.1", "5.2"] },
    { "id": 5, "tasks": ["3.3", "3.4", "3.5", "3.6", "3.7", "4.1", "4.8"] },
    { "id": 6, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.9", "5.3"] },
    { "id": 7, "tasks": ["4.6", "4.7", "5.4", "6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3", "6.4", "6.5", "6.6", "6.7"] },
    { "id": 9, "tasks": ["7"] },
    { "id": 10, "tasks": ["8.1"] },
    { "id": 11, "tasks": ["8.2"] },
    { "id": 12, "tasks": ["8.3"] },
    { "id": 13, "tasks": ["8.4"] },
    { "id": 14, "tasks": ["8.5"] },
    { "id": 15, "tasks": ["8.6"] },
    { "id": 16, "tasks": ["8.7", "8.8"] },
    { "id": 17, "tasks": ["9.1", "10.1"] },
    { "id": 18, "tasks": ["9.2", "9.3", "10.2", "10.3", "10.4"] },
    { "id": 19, "tasks": ["10.5"] },
    { "id": 20, "tasks": ["11"] },
    { "id": 21, "tasks": ["12.1", "12.3"] },
    { "id": 22, "tasks": ["12.2", "12.4"] },
    { "id": 23, "tasks": ["12.5", "12.6"] },
    { "id": 24, "tasks": ["12.7", "12.8", "12.9"] },
    { "id": 25, "tasks": ["13"] },
    { "id": 26, "tasks": ["14.1", "14.2", "14.8"] },
    { "id": 27, "tasks": ["14.3", "14.4", "14.9", "14.10"] },
    { "id": 28, "tasks": ["14.5", "14.6", "14.7", "15.1"] },
    { "id": 29, "tasks": ["15.2"] },
    { "id": 30, "tasks": ["15.3", "15.4", "15.6", "15.8", "15.10", "15.12"] },
    { "id": 31, "tasks": ["15.5", "15.7", "15.9", "15.11", "15.13"] },
    { "id": 32, "tasks": ["16"] },
    { "id": 33, "tasks": ["17.1"] },
    { "id": 34, "tasks": ["17.2", "17.3", "17.4", "17.5"] },
    { "id": 35, "tasks": ["18.1"] },
    { "id": 36, "tasks": ["18.2"] },
    { "id": 37, "tasks": ["18.3", "18.4"] },
    { "id": 38, "tasks": ["18.5"] },
    { "id": 39, "tasks": ["19"] },
    { "id": 40, "tasks": ["20"] },
    { "id": 41, "tasks": ["21"] },
    { "id": 42, "tasks": ["22.1"] }
  ]
}
```
