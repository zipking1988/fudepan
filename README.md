# Fudepan

Fudepan turns a photo of a handwritten family note into care tasks that have an owner. It surfaces missing information instead of guessing it, and it requires a person to approve anything high-risk. It is a care-coordination tool, not a medical, medication or payment tool.

Stack: Next.js (App Router), TypeScript, Tailwind CSS, Supabase (Postgres, Auth, Storage), Zod, Vitest. AI calls go through the ai& OpenAI-compatible API, from server code only.

## Run it locally

Requirements: Node.js, pnpm 10, and the Supabase CLI with Docker.

```bash
pnpm install
supabase start              # local Postgres, Auth and Storage; applies supabase/migrations
cp .env.example .env.local  # then fill in the values; see below
pnpm dev                    # http://localhost:3000
```

The demo household in `supabase/seed.sql` is loaded by `supabase db reset`, which erases all local data first. Run it only on a fresh or disposable local stack, never on one holding data you want to keep. Without it, the app works but the demo sign-in has nothing to open.

Environment variables (names and meaning are documented in `.env.example`):

- Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Server only: `SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL`, `AIAND_BASE_URL`, `AIAND_API_KEY`, `AIAND_MODEL`, `CRON_SECRET`.
- Optional demo sign-in, server only: `DEMO_EMAIL`, `DEMO_PASSWORD`. Use an account that belongs only to a fictional household. The seeded local account is described in `supabase/seed.sql`. When either is unset, `/login` hides the demo box and the landing page offers the normal login instead.

Do not commit `.env.local`. Choose `AIAND_MODEL` from your account's model list; it must support vision input.

Scripts:

```bash
pnpm typecheck
pnpm lint
pnpm test                 # unit tests
pnpm test:integration     # integration tests (needs the local stack and env)
pnpm test:db              # database tests in supabase/tests/database
pnpm build
```

## Testing it as a judge

No setup is needed for the public pages. For the signed-in app, run the local steps above.

1. **Landing example (`/` in Japanese, `/en` in English).** Act as Misa, Kenta or Yui and take, confirm and complete the four tasks. Kenta starts assigned as driver and owner of the clinic visit. The guards on completing the visit are: the clinic name is entered, a companion is set, the primary caregiver (Misa) approves it, and only the owner (Kenta) can mark it done. At 4 of 4 a celebration appears with links onward.
2. **Role demo (`/demo`, or `/demo?lang=en`).** Walk through the family and Grandma views. Only `ja` and `en` are accepted for `lang`; anything else opens in Japanese. A language switch is on the page.
3. **Demo family in the real app (`/login`).** With `DEMO_EMAIL` and `DEMO_PASSWORD` set, use "Sign in to the demo". Open `/family`, pick a note, and use the "What to do next" block and the task cards.
4. **Your own note.** Log in and open `/family/capture`. This needs the local Supabase stack and ai& variables.
5. **Evidence.** Open a note's record from the task board (`/family/events/<noteId>/timeline`) to see saved history.

## What is simulated and what is real

The landing example and `/demo` are simulated in the browser with made-up data. They run the same completion rule as the app, but nothing is saved or sent, and no AI reads anything.

Only the signed-in app does real work: image upload to Supabase Storage, server-side ai& extraction, Zod validation of its output, database writes, authorization by household membership, approval, completion, reminders and the audit timeline.

## From spec to evidence

One rule, traced end to end:

1. **Spec.** `.kiro/specs/fudepan-care-chain/requirements.md`: "High-risk actions remain blocked until explicitly approved."
2. **Rule and test.** `src/lib/care/rules/completion.ts` (`decideCompletion`) is tested in `src/lib/care/rules/completion.test.ts`, which checks that completion is refused with `approval_pending` while approval is pending or rejected.
3. **Server guard.** The `completePart` server action (`src/app/(family)/family/actions.ts`) goes through `src/lib/care/part-actions.ts`, which calls the database function `public.complete_part`, defined in `supabase/migrations/20261217000000_optional_completion_proof.sql`. Authorization is enforced in the database, not the browser. Database tests are in `supabase/tests/database/part_approval.test.sql` and `part_completion.test.sql`.
4. **Timeline.** Completing a task writes a `part.completed` audit event, which the note's timeline page shows. Proof of completion is optional.

Other specs: `.kiro/specs/family-shared-care` and `.kiro/specs/family-app-demo-parity`. Product and safety steering is in `.kiro/steering`.

## Deploying

The app targets Vercel. `vercel.json` schedules `/api/cron/sweep` every five minutes, protected by `CRON_SECRET`.
