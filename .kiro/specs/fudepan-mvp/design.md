# Fudepan MVP Design

## Architecture

```text
Client (Next.js)
  -> API routes
    -> Supabase Auth / PostgreSQL / Storage
    -> OCR adapter
    -> LLM task parser
    -> Risk rules
    -> Task workflow
    -> Notification service
    -> Calendar adapter
    -> Audit service
```

## Frontend

- Next.js App Router with TypeScript.
- Tailwind CSS for accessible, mobile-first UI.
- React Query or SWR for client data fetching.
- Zod for runtime validation of API inputs and AI outputs.

### Main screens

1. **Home / Note Inbox**  
   Upload a note, view recent notes, and start a new task.

2. **Task Review**  
   Show original note, OCR text, structured fields, risk level, and confirmation controls.

3. **Household Board**  
   Filter tasks by status, assignee, category, and risk level.

4. **Task Detail**  
   Show task information, original note, activity timeline, and audit trail.

5. **Household Settings**  
   Manage members, roles, notification preferences, and connected calendar.

## Backend

- Supabase PostgreSQL stores households, members, notes, tasks, and audit events.
- Supabase Storage stores original note images with private bucket access.
- Supabase Auth handles email magic-link authentication.
- Next.js API routes call OCR, LLM, calendar, and notification providers.
- Row Level Security restricts records by household membership.

## AI pipeline

1. Receive image or text.
2. Run OCR when an image is supplied.
3. Send OCR text, image metadata, and a strict JSON schema to the LLM.
4. Validate the model response with Zod.
5. Classify task category and calculate risk.
6. Create a draft task; do not execute external actions.
7. Request human confirmation when risk is medium or high.
8. After approval, call calendar/notification tools and write audit events.

## Risk rules

| Condition | Risk |
|---|---|
| Medication, prescription, hospital, clinic | High |
| Payment, bank transfer, invoice, bill, credit card | High |
| Appointment, reservation, government procedure | High |
| Pickup, transportation, travel | High |
| Reminder, shopping list, general household chore | Low |
| Unknown or low-confidence extraction | Medium |

## Security

- Never store full ID, insurance, bank-account, or card numbers in plaintext.
- Mask detected sensitive values before persistence and display.
- Use service-role database access only on the server.
- Require household membership for every task read or write.
- Do not allow an LLM to directly execute payment, deletion, or account-change actions.

## Observability

- Log request ID, household ID, task ID, provider name, latency, and outcome.
- Do not log raw OCR text or images by default.
- Record model provider, model version, prompt version, and confidence.
