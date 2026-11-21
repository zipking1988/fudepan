# ai& Usage Policy

ai& is the AI provider for Fudepan.

It is used to understand handwritten notes and produce a structured Care Chain draft.

## Allowed uses

ai& may:

- Perform OCR-like extraction from a handwritten note image
- Identify likely care tasks
- Extract dates, locations, people, objects, and intentions
- Detect ambiguity and missing information
- Classify risk level
- Suggest a responsible household role
- Produce a structured JSON Care Chain draft
- Generate short, plain-language explanations for family members

## Prohibited uses

ai& must never:

- Diagnose a medical condition
- Recommend starting, stopping, or changing medication
- Provide medical, legal, or financial advice
- Automatically execute a high-risk action
- Automatically assign a person to a high-risk task
- Invent a hospital, date, time, medication, amount, or person
- Pretend that uncertain information is certain
- Bypass human approval
- Access or modify data outside the current household

## Required output behavior

Every ai& response must:

- Be valid JSON
- Match the Care Chain schema
- Include confidence values
- Include source quotes where possible
- Identify ambiguities instead of guessing
- Mark high-risk actions as `pending_approval`
- Clearly state when medical judgment is required

## Failure behavior

If ai& returns invalid, incomplete, or unsafe output:

1. Do not write it directly to the database.
2. Validate it with Zod.
3. Run Kiro validation hooks.
4. Save the failure as an audit event.
5. Ask the user for clarification.
6. Never silently fabricate missing information.

## Server-side rule

`AIAND_API_KEY` must remain server-side.

It must never be:

- Sent to the browser
- Included in a client bundle
- Written into a public repository
- Logged in plaintext
- Stored in Supabase
