# Technology Steering

## Preferred stack

- Next.js App Router with TypeScript.
- Tailwind CSS.
- Supabase for Auth, PostgreSQL, Storage, and Realtime.
- Zod for validation.
- Vitest for unit tests.
- Playwright for end-to-end tests.
- Vercel for deployment.

## Coding standards

- Use TypeScript strict mode.
- Prefer server-side API routes for provider credentials and privileged database access.
- Never expose service-role keys to the browser.
- Use typed API responses and Zod validation at every trust boundary.
- Keep OCR, LLM, calendar, and notification providers behind adapter interfaces.
- Write tests for parsing, risk rules, permissions, and audit events.
- Use conventional commits and small, reviewable pull requests.

## Repository layout

```text
src/
  app/
  components/
  lib/
    ai/
    ocr/
    calendar/
    notifications/
    risk/
    audit/
  server/
  types/
.kiro/
  specs/
  steering/
  hooks/
  settings/
```
