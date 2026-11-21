# Technology Steering

## Required stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase
- Vercel
- ai& API
- Zod
- Vitest
- Kiro MCP
- Kiro Crew

## Deployment

The application must deploy to Vercel.

All AI calls must occur in server-side code:

- Route Handlers
- Server Actions
- Server-only modules

Never call ai& directly from a client component.

## ai& integration

Use the ai& OpenAI-compatible API.

Base URL:

```env
AIAND_BASE_URL=https://api.aiand.com/v1
```

Required environment variables:

```env
AIAND_API_KEY=
AIAND_MODEL=
```

The model must support vision input.

Before selecting a model, query the available model list using the account’s API key. Do not assume a model is available.

## Image handling

1. Upload the original image to Supabase Storage.
2. Store only the storage path in the database.
3. Read the image server-side.
4. Upload it to ai& Files API.
5. Use the returned `file_id` in the chat completion request.
6. Do not expose the ai& file ID as a permanent public image URL.

## Data rules

- Store original notes in Supabase Storage.
- Store extracted text and structured Care Chain data in PostgreSQL.
- Store audit events in PostgreSQL.
- Never store API keys in the database.
- Never log raw sensitive note contents.
- Mask medication names, insurance numbers, addresses, bank data, and government IDs in logs and analytics.

## Quality gates

Before completion, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Do not mark a phase complete if any gate fails.
