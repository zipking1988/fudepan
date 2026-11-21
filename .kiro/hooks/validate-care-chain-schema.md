# Hook: Validate Care Chain Schema

## Trigger

Run after ai& returns a Care Chain draft and before it is saved to Supabase.

## Purpose

Ensure that every AI-generated Care Chain is structurally valid, safe, and reviewable.

## Checks

Reject the draft if any of the following are true:

- JSON cannot be parsed.
- `chain_title` is missing.
- `steps` is empty.
- A step is missing `title`, `care_category`, `risk_level`, or `status`.
- A high-risk step does not have `approval_required = true`.
- A high-risk step is not in `pending_approval`.
- A medical action is marked as automatically executable.
- A due date was invented without a source quote or explicit user-provided value.
- A responsible person was assigned without household-member validation.
- `confidence` is missing or outside the range 0 to 1.
- `audit_event_id` is missing.

## Required action

If validation fails:

1. Do not save the Care Chain as approved.
2. Save it as `needs_clarification` or `extraction_failed`.
3. Create an audit event.
4. Return clear clarification questions to the user.
5. Never silently repair unsafe AI output.
