# Hook: Require Audit Trail

## Trigger

Run after:

- A note is uploaded
- ai& extraction completes or fails
- A Care Chain is created
- A Care Chain is edited
- An owner is assigned
- An owner accepts a task
- A human approves or rejects an action
- An MCP tool executes
- Evidence is uploaded
- A task completes, fails, or escalates

## Purpose

Ensure that every meaningful state change is traceable.

## Required audit fields

Each audit event must include:

- `household_id`
- `care_chain_id`
- `care_step_id`, when applicable
- `actor_type`
- `actor_id`
- `event_type`
- `payload`
- `created_at`

## Required payload fields for AI extraction

- Model name
- Prompt version
- Confidence
- Source image reference
- Extraction status
- Validation result
- Human review status

## Rule

If an important action completes without an audit event, the operation must be considered incomplete.

Do not allow silent state changes.
