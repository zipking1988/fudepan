# MCP Tool: Household Tools

## Purpose

Give the Kiro agent controlled access to household context, without exposing raw sensitive data unnecessarily.

## Tools

### `household.get_members`

Returns:

- Member ID
- Display name
- Role
- Responsibilities
- Active status

Does not return private contact details unless explicitly required and authorized.

### `household.get_responsibility_map`

Returns:

- Care recipient
- Primary caregiver
- Medical coordinator
- Finance coordinator
- Transport coordinator
- Emergency contact
- Professional caregiver

### `household.get_pending_tasks`

Returns:

- Care Chain ID
- Step ID
- Title
- Risk level
- Owner
- Due time
- Escalation time
- Missing information
- Approval status

### `household.record_execution_evidence`

Allows an authorized household member to attach:

- Photo
- Text confirmation
- Link
- Completion note
- Failure reason

## Rule

The agent may read household context to recommend responsibility, but it may not assign a high-risk owner without human acceptance.
