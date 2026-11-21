# Fudepan Care Chain — Design

## Architecture

```text
Browser
  -> Next.js UI on Vercel
  -> Vercel API Route / Server Action
  -> Supabase Storage
  -> ai& Files API
  -> ai& Chat Completions
  -> Zod validation
  -> Kiro validation hooks
  -> Supabase PostgreSQL
  -> Household review and approval
  -> Kiro MCP execution
  -> Audit trail
```

## Deployment target

- Frontend: Next.js App Router on Vercel
- Server logic: Vercel Server Actions and Route Handlers
- Database: Supabase PostgreSQL
- Auth: Supabase Auth
- File storage: Supabase Storage
- AI provider: ai& API
- AI model: vision-capable model selected from the account’s available model list
- Agent execution: Kiro MCP tools
- Persistent agent: Kiro Crew Care Concierge

## Environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AIAND_API_KEY=
AIAND_BASE_URL=https://api.aiand.com/v1
AIAND_MODEL=
APP_BASE_URL=
```

Security rules:

- Never expose `AIAND_API_KEY` to the browser.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- Call ai& only from server-side code.
- Store secrets in Vercel Environment Variables.
- Do not commit `.env` files.

## Database model

### households

```sql
id uuid primary key,
name text not null,
created_at timestamptz not null default now()
```

### household_members

```sql
id uuid primary key,
household_id uuid not null references households(id),
user_id uuid not null,
display_name text not null,
role text not null,
responsibilities text[] not null default '{}',
is_active boolean not null default true,
created_at timestamptz not null default now()
```

Possible roles:

- `care_recipient`
- `primary_caregiver`
- `family_member`
- `medical_coordinator`
- `finance_coordinator`
- `transport_coordinator`
- `emergency_contact`
- `professional_caregiver`

### notes

```sql
id uuid primary key,
household_id uuid not null references households(id),
uploaded_by uuid not null,
image_path text not null,
original_text text,
status text not null default 'uploaded',
created_at timestamptz not null default now()
```

### care_chains

```sql
id uuid primary key,
household_id uuid not null references households(id),
note_id uuid not null references notes(id),
title text not null,
status text not null default 'pending_review',
risk_level text not null,
created_by_ai boolean not null default true,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

### care_steps

```sql
id uuid primary key,
care_chain_id uuid not null references care_chains(id),
title text not null,
description text,
care_category text not null,
risk_level text not null,
owner_id uuid references household_members(id),
backup_owner_id uuid references household_members(id),
due_at timestamptz,
escalation_at timestamptz,
status text not null default 'pending_review',
evidence_required text[] not null default '{}',
approval_required boolean not null default false,
source_quote text,
confidence numeric,
created_at timestamptz not null default now(),
updated_at timestamptz not null default now()
```

### audit_events

```sql
id uuid primary key,
household_id uuid not null,
care_chain_id uuid references care_chains(id),
care_step_id uuid references care_steps(id),
actor_type text not null,
actor_id uuid,
event_type text not null,
payload jsonb not null default '{}',
created_at timestamptz not null default now()
```

## Care Chain state machine

```text
uploaded
  -> extracting
  -> extraction_failed
  -> pending_review
  -> needs_clarification
  -> awaiting_owner_acceptance
  -> approved
  -> in_progress
  -> evidence_required
  -> completed
  -> failed
  -> escalated
  -> cancelled
```

## AI output contract

ai& must return JSON matching this shape:

```json
{
  "chain_title": "string",
  "overall_risk": "low | medium | high",
  "steps": [
    {
      "title": "string",
      "description": "string",
      "care_category": "medical | medication | appointment | payment | transport | document | household | communication",
      "risk_level": "low | medium | high",
      "suggested_owner_role": "string",
      "due_at": "ISO 8601 datetime or null",
      "escalation_at": "ISO 8601 datetime or null",
      "evidence_required": ["string"],
      "approval_required": true,
      "source_quote": "string",
      "confidence": 0.0
    }
  ],
  "ambiguities": [
    {
      "field": "string",
      "question": "string",
      "reason": "string"
    }
  ],
  "ai_boundary": {
    "medical_advice_requested": false,
    "blocked_actions": ["string"],
    "explanation": "string"
  }
}
```

## Validation rules

The server must reject an AI response if:

- JSON cannot be parsed
- Required fields are missing
- A high-risk step is not `pending_approval`
- A medical action is marked as automatically executable
- A date is invented without evidence in the source note
- A person is assigned without household-member validation
- Medication, insurance, bank, address, or government ID data appears unmasked in logs

## Kiro responsibilities

### Specs

Define the Care Chain domain, approval flow, audit requirements, and acceptance criteria.

### Steering

Define the product constitution, AI boundaries, privacy rules, accessibility standards, and technology constraints.

### Hooks

Enforce schema, safety, privacy, accessibility, and quality gates.

### MCP

Execute only human-approved calendar, notification, and household tool actions.

### Kiro Crew

Run a daily Care Concierge briefing that identifies unowned, unconfirmed, overdue, and escalating care responsibilities.
