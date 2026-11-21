# Fudepan Care Chain — Implementation Tasks

## Phase 1: Foundation

- [x] Create Next.js App Router project.
- [x] Configure TypeScript, ESLint, Prettier, and Vitest.
- [x] Configure Supabase client for server and browser.
- [x] Add environment variable validation.
- [x] Create database migrations for households, members, notes, care chains, care steps, and audit events.
- [x] Add row-level security policies.
- [x] Add seed data for a demo household.

## Phase 2: Note upload

- [x] Create note upload page.
- [x] Support image upload through Supabase Storage.
- [x] Validate file type, size, and ownership.
- [x] Store original image path in `notes`.
- [x] Create note detail page.
- [x] Show upload status and error states.

## Phase 3: ai& extraction

- [ ] Create server-only ai& client.
- [ ] Add `AIAND_API_KEY`, `AIAND_BASE_URL`, and `AIAND_MODEL` environment variables.
- [ ] Upload image to ai& Files API.
- [ ] Call chat completions with the image `file_id`.
- [ ] Request structured JSON output.
- [ ] Validate output with Zod.
- [ ] Save Care Chain draft as `pending_review`.
- [ ] Create audit event for every extraction attempt.
- [ ] Mask sensitive data in logs and error traces.
- [ ] Handle missing, invalid, or low-confidence output safely.

## Phase 4: Care Chain review

- [ ] Create Care Chain review page.
- [ ] Display extracted steps, risk levels, due dates, and ambiguities.
- [ ] Allow editing of titles, descriptions, dates, and owners.
- [ ] Allow adding or removing steps.
- [ ] Require clarification for missing critical fields.
- [ ] Prevent approval while required information is missing.
- [ ] Record every edit as an audit event.

## Phase 5: Household responsibility

- [ ] Create household member management.
- [ ] Define roles and responsibilities.
- [ ] Recommend an owner based on role and history.
- [ ] Require owner acceptance before execution.
- [ ] Support backup owner assignment.
- [ ] Show responsibility map for the household.

## Phase 6: Approval and execution

- [ ] Block high-risk actions until approved.
- [ ] Create approval UI with explicit consent language.
- [ ] Record approver, timestamp, and approval scope.
- [ ] After approval, allow Kiro MCP to create calendar events.
- [ ] After approval, allow Kiro MCP to send reminders.
- [ ] Write execution evidence to the audit trail.
- [ ] Prevent AI from executing high-risk actions directly.

## Phase 7: Escalation

- [ ] Implement escalation timestamps.
- [ ] Detect unaccepted or overdue tasks.
- [ ] Notify the primary owner.
- [ ] Notify the backup owner after escalation threshold.
- [ ] Mark unowned high-risk work as `escalated`.
- [ ] Show escalation history in the household timeline.

## Phase 8: Evidence and timeline

- [ ] Allow upload of completion evidence.
- [ ] Support photo, text note, link, and confirmation types.
- [ ] Create Care Chain timeline.
- [ ] Show note origin, AI extraction, edits, approvals, escalations, execution, and completion.
- [ ] Make audit events immutable.

## Phase 9: Kiro Crew

- [ ] Create Care Concierge Crew agent.
- [ ] Generate daily household responsibility briefing.
- [ ] Identify unowned high-risk tasks.
- [ ] Identify tasks approaching escalation.
- [ ] Identify overdue or failed tasks.
- [ ] Send briefing to authorized household members.

## Phase 10: Submission

- [ ] Add public README.
- [ ] Add architecture diagram.
- [ ] Add Kiro usage documentation.
- [ ] Add demo accounts and demo data.
- [ ] Deploy to Vercel.
- [ ] Verify public URL works.
- [ ] Record 3-minute demonstration video.
- [ ] Verify `.kiro/` directory is present in public repository.
- [ ] Verify all submission requirements are met.
