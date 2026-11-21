# Hook: Block High-Risk Auto Execution

## Trigger

Run before any MCP tool invocation, external API call, or state transition that would execute a care action.

## Purpose

Prevent AI or an agent from executing a high-risk action without explicit human approval.

## Protected action types

- Medical appointment creation or cancellation
- Medication change
- Medication pickup
- Doctor communication
- Payment
- Insurance submission
- Government paperwork
- Transport or pickup
- External messaging
- Deletion
- Sharing sensitive information

## Rule

If `risk_level == "high"` and `approval_required == true`, the action must not proceed unless:

1. An authorized household member has explicitly approved it.
2. The approval is recorded in `audit_events`.
3. The approver, timestamp, and approved scope are stored.
4. The Care Chain step is in `approved` or `in_progress`.

## Required action

If approval is missing:

1. Block the action.
2. Return status `pending_approval`.
3. Notify the responsible household member.
4. Create an audit event.
5. Do not retry automatically.
