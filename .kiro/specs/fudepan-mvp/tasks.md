# Fudepan MVP Tasks

## Phase 1: Foundation

- [ ] Initialize Next.js, TypeScript, Tailwind CSS, ESLint, and Vitest.
- [ ] Configure Supabase project, environment variables, and `.env.example`.
- [ ] Create database migrations for households, members, notes, tasks, and audit events.
- [ ] Enable Row Level Security and household-membership policies.
- [ ] Create private Supabase Storage bucket for note images.
- [ ] Add Zod schemas for note input, parsed task, and task update.

## Phase 2: Note ingestion

- [ ] Build mobile-first upload screen.
- [ ] Support image upload to Supabase Storage.
- [ ] Support pasted text as an alternative input.
- [ ] Create OCR adapter interface.
- [ ] Implement Google Cloud Vision or AWS Textract adapter.
- [ ] Add OCR confidence and low-confidence warnings.
- [ ] Display original image beside extracted text.

## Phase 3: Task extraction

- [ ] Define strict JSON schema for extracted tasks.
- [ ] Implement LLM parser with date normalization.
- [ ] Map extracted data to task categories.
- [ ] Implement risk classification rules.
- [ ] Create task-review screen with editable fields.
- [ ] Prevent task creation when required fields are missing or unsafe.
- [ ] Add unit tests for parser, category mapping, and risk rules.

## Phase 4: Household workflow

- [ ] Implement household creation and member invitation.
- [ ] Implement role-based permissions.
- [ ] Build household task board.
- [ ] Implement task claim, assignment, completion, and cancellation.
- [ ] Implement high-risk confirmation flow.
- [ ] Build task detail page with activity timeline.

## Phase 5: Integrations

- [ ] Implement Google Calendar OAuth connection.
- [ ] Create calendar event after high-risk task approval.
- [ ] Implement email notification adapter.
- [ ] Implement web push notification adapter.
- [ ] Add reminder scheduling for due tasks.
- [ ] Add audit events for every external action.

## Phase 6: Kiro integration

- [ ] Add `.kiro/steering/` product, tech-stack, safety, and accessibility files.
- [ ] Add sensitive-file guard Hook.
- [ ] Add task-schema validation Hook.
- [ ] Add accessibility-check Hook.
- [ ] Configure MCP servers in `.kiro/settings/mcp.json`.
- [ ] Implement internal Fudepan MCP tools for task and audit operations.
- [ ] Document Kiro usage in README.

## Phase 7: Demo and submission

- [ ] Seed safe demo household and demo notes.
- [ ] Add medication, payment-risk, and pickup scenarios.
- [ ] Test complete flow on desktop and mobile.
- [ ] Deploy to Vercel.
- [ ] Record 3-minute demonstration video.
- [ ] Write Devpost submission and README.
- [ ] Verify public repository, live demo, video, and `.kiro/` directory.
