# MCP Tool: Calendar

## Purpose

Create calendar events only after a Care Chain step has been approved by an authorized household member.

## Allowed actions

- Create an event for an approved appointment
- Create an event for an approved pickup or transport task
- Create an event for an approved medication pickup
- Create an event for an approved household deadline

## Forbidden actions

- Automatically booking a medical appointment
- Changing or cancelling an existing appointment
- Inviting external people without approval
- Creating events from unapproved AI output

## Required input

- `care_step_id`
- `household_id`
- `title`
- `start_at`
- `end_at`
- `location`
- `approved_by`
- `approval_event_id`

## Required behavior

1. Verify that the step is approved.
2. Verify that the approver belongs to the household.
3. Create the calendar event.
4. Store the external event ID in the audit trail.
5. Return success or a structured failure.
