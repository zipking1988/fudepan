# Fudepan

Family coordination assistant that turns photos or text of handwritten household notes into safe, reviewable tasks. Fudepan never pays, books, or changes accounts on its own. A household member approves every high-risk task.

Status: **Phase 1 (Foundation)**. Note upload, OCR, LLM parsing, calendar, notifications and MCP tools are not built yet. See `.kiro/specs/fudepan-mvp/tasks.md`.

## Run locally

Requirements: Node.js 20+, npm, and the [Supabase CLI](https://supabase.com/docs/guides/cli) with Docker (for a local database).

```bash
npm install
cp .env.example .env.local     # then fill in values; never commit .env.local
supabase start                 # local Postgres, Auth, Storage
supabase db reset              # applies supabase/migrations/*
npm run dev                    # http://localhost:3000
```

`supabase start` prints the local API URL and keys. Put them in `.env.local`.

### Environment variables

| Variable                        | Where            | Purpose                                                 |
| ------------------------------- | ---------------- | ------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | browser + server | Supabase project URL                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser + server | Public anon key. Access is limited by RLS               |
| `SUPABASE_SERVICE_ROLE_KEY`     | **server only**  | Bypasses RLS. Used only in `src/server/` and API routes |

### Scripts

| Command             | Action                                         |
| ------------------- | ---------------------------------------------- |
| `npm run typecheck` | TypeScript strict check                        |
| `npm run lint`      | ESLint                                         |
| `npm test`          | Vitest unit tests                              |
| `npm run test:e2e`  | Playwright (run `npx playwright install` once) |
| `npm run format`    | Prettier                                       |

## Database

Migrations in `supabase/migrations/`: `households`, `members`, `notes`, `tasks`, `audit_events`, Row Level Security by household membership, and a private `note-images` storage bucket (JPG/PNG/HEIC, 10 MB, path `<household_id>/<file>`). Audit events are append-only for clients, and there are no delete policies.

## Security notes

- Service-role access lives in `src/server/supabase-admin.ts` (`server-only`). Never import it from client code.
- `.env*` files other than `.env.example` are git-ignored.

## Note ingestion (Phase 2)

- **Add a note:** the Note Inbox has a photo upload form (JPG, PNG, HEIC, up to 10 MB) and a text form. It needs a signed-in user who belongs to a household. Sign-in and household setup arrive in Phase 4, so until then you can create a test user and member row with the Supabase Studio or CLI.
- **Storage:** photos go to the private `note-images` bucket at `<household_id>/<note_id>.<ext>` through the signed-in user's session, so RLS applies. The note page shows the photo through a 5-minute signed URL.
- **OCR:** `src/lib/ocr/` defines an `OcrAdapter` interface. The Google Cloud Vision adapter is used when `GOOGLE_CLOUD_VISION_API_KEY` is set. Without it, photos are saved and the page asks the user to check the photo. Vision does not read HEIC, so HEIC photos are saved but not read.
- **Third-party data:** only the single image is sent to Google Cloud Vision, with no household or user identifiers, to read the handwriting. Recognized text is masked before it is stored.
- **Low confidence:** reading confidence below 80% (or unknown) shows a warning next to the photo.
- **Sensitive values:** card, ID, bank-account, insurance, password and one-time-code values are replaced with `[MASKED]` in stored text. The original photo is kept as is, so the form warns users not to photograph those documents.

## Task extraction (Phase 3)

Open a note, press **Review as a task**, then **Suggest a task**. Fudepan fills the form with suggested fields. You edit them and press **Save draft**. A draft is never confirmed, approved, or acted on.

- **Setup:** set `AIAND_API_KEY` and `AIAND_MODEL` in `.env.local` (see `.env.example`). Choose a model from `GET https://api.aiand.com/v1/models` that has the `vision` capability and supports structured JSON output. `zai-org/glm-5.3-flash` is a good low-cost choice. Without a key the form still works for manual entry.
- **Database:** run `supabase db reset` to apply `0004_create_draft_task.sql`. It saves the draft task and its audit event in one transaction.
- **LLM provider:** ai& (OpenAI-compatible Chat Completions, called with `fetch` from server code only). The model ID comes from `AIAND_MODEL` and is recorded in each audit event with the prompt version, confidence and token usage.
- **Data sent to ai&:** masked note text, OCR confidence, the reference date and the time zone. The photo is attached only when OCR found no text or had low confidence, no private values were hidden in the OCR text, the model supports vision, and the photo is JPEG or PNG. Photos go through the ai& Files API and are deleted right after the request. Organizations on zero data retention send the photo inline instead, which ai& does not store. No household, member or user IDs are sent.
- **Structured output:** the request uses `response_format: json_schema` (strict). If ai& rejects it, the adapter retries once with `json_object`. Every response is validated with Zod (`src/lib/task-schema.ts`). Invalid, unsafe or low-confidence results leave the note untouched and the user fills in the form.
- **Dates:** the model returns a local date and time. Code converts them to ISO 8601 using the browser time zone, then `DEFAULT_TIMEZONE`, then `Asia/Tokyo`. A date without a time becomes 09:00 and is flagged for review.
- **Risk:** computed only in `src/lib/risk-rules.ts`, never by the model. Medication, payment, appointment and pickup are high. Routine reminders are low. Unknown or low-confidence results are medium.
- **Where things live:** prompt in `src/lib/ai/prompt.ts`, parser in `src/lib/ai/parser.ts`, adapter in `src/lib/ai/aiand.ts`, server logic in `src/server/api/tasks/`.
- **Tests:** `npm test` (add `-- task-schema risk-rules parser` to run the schema, risk and parser tests only).

## Household workflow and redesign (Phase 4)

### Try it

- **Without signing in:** open `/` and press **Try an example**. The example at `/demo` uses fictional data only. It never calls an API, an AI service or the database, and "Save draft (example)" only explains that nothing was saved.
- **With a real account:** press **Upload my note**, or go to `/login`, and enter an email address. Supabase sends a magic link. Locally, Supabase catches the email in Mailpit; `supabase start` prints its URL.
- **Invite family:** in **Household Settings** a coordinator creates a one-time link (expires in 7 days, optionally locked to one email). Fudepan sends no email itself; share the link by hand.

### Roles

| Action                                                | Elder          | Caregiver | Coordinator |
| ----------------------------------------------------- | -------------- | --------- | ----------- |
| View household tasks, add notes                       | ✓              | ✓         | ✓           |
| Save and edit drafts, claim, assign, ask for approval |                | ✓         | ✓           |
| Approve or reject (including high-risk)               |                | ✓         | ✓           |
| Mark as done                                          | own tasks only | ✓         | ✓           |
| Cancel (reason required)                              |                | ✓         | ✓           |
| Invite members, change roles                          |                |           | ✓           |

### Approval flow

`draft → awaiting_confirmation → confirmed → completed`. Only a low-risk draft may be approved directly. Medication, payment, appointment and pickup tasks are always high risk and always wait for a caregiver or coordinator. Approval needs an explicit checkbox and only marks the task as confirmed; it never pays, books, or sends anything.

The rules are enforced three times: in `src/lib/workflow/transitions.ts` (UI and API), in the `apply_task_action` database function, and in the `enforce_task_workflow` trigger, which applies to every writer including the service role. Browsers can read tasks but cannot write them; every task change goes through a server route and a service-role-only function that re-checks the actor's role and writes the audit event in the same transaction.

### Migrations added

- `0005_invitations_and_membership.sql`: `invitations` table (token hashes only), household and membership functions, new household-level audit event types, browser inserts into `members` removed.
- `0006_task_workflow.sql`: browser task writes removed, browser audit inserts limited to `note_created` and `task_extracted`, workflow trigger, `create_draft_task` (now role-checked) and `apply_task_action`.

### End-to-end tests

```bash
supabase start          # local stack in Docker
supabase db reset       # applies all migrations
npm run test:e2e        # starts Next.js on port 3100 with keys from `supabase status`
```

The tests create fake users on the reserved `example.test` domain, refuse to seed anything other than a local Supabase URL, and blank the ai& and Vision keys so no external service is called.

### Add to calendar

Approved tasks with a due date show **Download calendar file** on the task page. It downloads a standard `.ics` file that opens in Google, Apple or Outlook Calendar, with a reminder one hour before. Any member of the household can export a task to their own calendar.

- **No calendar account connection:** no OAuth, no stored tokens, and no data sent to a calendar provider by Fudepan. The person chooses where to open the file.
- **Data minimisation:** the file contains only the masked title, the masked location, the due time, the category and a link back to the task. Task notes and note text are never included.
- **Audit:** every export writes a `calendar_event_created` event (`method: "ics_download"`) before the file is returned, and appears in the activity timeline. If the audit event cannot be written, nothing is exported.
- **Safety:** only `confirmed` tasks can be exported. The endpoint is POST-only with a same-origin check, so another site cannot trigger it.
- Code: `src/lib/calendar/ics.ts` (file format), `src/server/api/tasks/calendar.ts`, `src/app/api/tasks/[id]/calendar/route.ts`.

## Landing page: one note becomes a task

The public landing page (`/`) tells one story with scrolling: Grandma writes a note by hand, and the family turns it into a task they check together.

- **Hero (pinned, scroll-driven).** One fictional medication note in Japanese handwriting lies on a table. As you scroll, a camera frame locks onto it (**Photo**), a reading line passes over it (**Read**), each phrase flies into the field it became (**Draft**), and the unclear parts are flagged (**Review**): 「木曜」 needs a date check, 「5時までに」 is a deadline with no AM/PM, 「アキにたのむ?」 only suggests Aki, so nobody is assigned. The step buttons jump to each step; **Skip** goes past the hero. Native scrolling drives the motion; the timeline and layout maths are pure functions in `src/lib/demo/scene.ts`.
- **Scam check.** A note written after a fake-police call. Its warning signs are marked, it is stamped 「要確認」 (check first) and held for a caregiver. **Replay** plays the sequence again.
- **The family decides.** A line draws through Grandma → Fudepan → Aki → Ren (caregiver) → task history as you scroll.
- **Try the safety rules.** A sandbox that runs the real masking, category, risk and scam rules in the browser (`src/lib/demo/check-note.ts`). Nothing is sent or saved. Reading dates, places and names needs the AI step, which only runs inside a signed-in household.
- **Example page (`/demo`).** The same scene, driven by a slider (keyboard arrows work), a Play button and step buttons, followed by an editable review form. "Save draft (example)" only explains that nothing was saved.
- **What is real, what is example.** Category, risk and the scam flag on both notes come from the app's real rules (`src/lib/risk-rules.ts`) at render time. The note text and card wording are fictional example content (`src/lib/demo/fixtures.ts`, `src/lib/demo/landing.ts`). The only percentage on the page is the sourced 51%.
- **No network on these pages.** No API, AI or database calls, and no notifications.
- **Accessibility.** With reduced motion, or without JavaScript, both pages show the finished example as a still layout with the four steps written out. Text is at least 18px, risk uses an icon plus text, and the Japanese text is marked `lang="ja"`.
- **Fonts.** Geist (interface) and Zen Kurenaido (Japanese handwriting), self-hosted by `next/font`. The files are downloaded once at build time.

### Sources

| Figure                                                                                                                | Source                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¥142.3B (1,423.1億円) lost to special fraud in Japan in 2025, +98.0% on 2024; fake-police scams ¥100.5B (1,005.0億円) | National Police Agency, 令和7年における特殊詐欺及びSNS型投資・ロマンス詐欺の認知・検挙状況等について（確定値）, 2026-05-22. [Statistics page](https://www.npa.go.jp/publications/statistics/sousa/sagi.html)                                                                                                                 |
| 51% of people who reported a third-party intervention avoided losing money                                            | FINRA Investor Education Foundation, BBB Institute for Marketplace Trust and Stanford Center on Longevity, _Exposed to Scams: What Separates Victims from Non-Victims?_, September 2019. [PDF](https://www.finrafoundation.org/sites/finrafoundation/files/exposed-to-scams-what-separates-victims-from-non-victims_0_0.pdf) |
| About 30% of households with someone aged 65+ are single-person; about 30% are couple-only                            | Cabinet Office, 令和6年版高齢社会白書 (Annual Report on the Ageing Society 2024), section 1-1-3. [Web](https://www8.cao.go.jp/kourei/whitepaper/w-2024/html/zenbun/s1_1_3.html)                                                                                                                                              |
| Families organise home life with paper notes, calendars and lists                                                     | Taylor & Swan, "Artful Systems in the Home", CHI 2005. [Microsoft Research](https://www.microsoft.com/en-us/research/publication/artful-systems-in-the-home/)                                                                                                                                                                |
