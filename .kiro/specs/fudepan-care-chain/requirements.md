# Fudepan Care Chain — Requirements

## Product goal

Fudepan turns a handwritten household note into a safe, editable, and accountable care workflow.

The product is not a generic AI assistant. It is a care-coordination system for families.

## Primary user story

As a family caregiver, I want to photograph a handwritten note from an older family member, so that the household can turn it into clear, owned, deadline-bound tasks without losing important context.

## Core flow

1. A caregiver uploads a photo of a handwritten note.
2. The server stores the original image in Supabase Storage.
3. The server sends the image to the ai& vision model.
4. ai& extracts text, intent, entities, risks, and ambiguities.
5. ai& returns a structured Care Chain draft.
6. Kiro validation hooks inspect the draft.
7. The draft is saved as `pending_review`.
8. A family member reviews, edits, assigns, and approves tasks.
9. High-risk actions remain blocked until explicitly approved.
10. After approval, Kiro MCP tools may create calendar events, send reminders, and record execution evidence.
11. Every state change is written to an immutable audit trail.
12. The household can view a complete Care Chain timeline.

## Care Chain definition

A Care Chain is a group of related care steps derived from one note.

Every step must contain:

- `id`
- `title`
- `description`
- `care_category`
- `risk_level`
- `owner_id`
- `backup_owner_id`
- `due_at`
- `escalation_at`
- `status`
- `evidence_required`
- `approval_required`
- `source_quote`
- `confidence`
- `audit_event_id`

## Required risk levels

- `low`
- `medium`
- `high`

High risk must be used for:

- Medical appointments
- Medication pickup or medication changes
- Questions for a doctor
- Payments
- Government or insurance paperwork
- Travel or pickup of a vulnerable person
- Deletion or sharing of sensitive information
- External communication on behalf of another person

## Mandatory human approval

The following actions must never be executed automatically:

- Booking, changing, or cancelling a medical appointment
- Changing or stopping medication
- Making a payment
- Sending a message to a doctor, pharmacy, school, employer, or agency
- Sharing medical or financial information externally
- Deleting a note, task, or audit record
- Travelling to pick up a person

These actions must remain in `pending_approval` until an authorized household member approves them.

## Missing information rule

If a note lacks information required for safe execution, the system must not guess.

It must generate clarification questions such as:

- Which hospital or clinic?
- What exact date and time?
- Who is responsible?
- Which insurance document is needed?
- What medication should be picked up?
- Who should be notified if the task is not completed?

## AI boundary

ai& may:

- Read handwritten text
- Identify likely tasks
- Extract dates, places, people, objects, and intent
- Identify missing information
- Classify risk
- Propose a Care Chain draft
- Explain why a task needs human confirmation

ai& must not:

- Diagnose a condition
- Recommend starting, stopping, or changing medication
- Provide medical advice
- Automatically execute high-risk actions
- Assign a human owner without review
- Invent dates, hospitals, names, or amounts
- Bypass approval rules

## Acceptance criteria

1. A user can upload a handwritten note photo.
2. The system creates a Care Chain draft.
3. The draft is editable before approval.
4. High-risk tasks cannot move to execution without approval.
5. Missing critical fields trigger clarification questions.
6. Every AI extraction creates an audit event.
7. Every approval, rejection, escalation, and completion is auditable.
8. The household timeline shows the full history of a Care Chain.
9. The application is deployable to Vercel.
10. The application uses ai& only through server-side API routes.
