# MCP Tool: Notifications

## Purpose

Send reminders, assignment requests, and escalation alerts to authorized household members.

## Allowed actions

- Ask a member to accept responsibility
- Remind an owner before a deadline
- Escalate an unaccepted or overdue high-risk task
- Notify the household when evidence is required
- Send a daily Care Concierge briefing

## Forbidden actions

- Contact doctors, pharmacies, employers, or agencies without explicit approval
- Share medical details in a notification
- Send messages outside the household
- Automatically retry indefinitely

## Required input

- `care_step_id`
- `household_id`
- `recipient_id`
- `notification_type`
- `deadline`
- `risk_level`
- `escalation_level`

## Required behavior

1. Verify recipient belongs to the household.
2. Mask sensitive details.
3. Send notification.
4. Store delivery result in audit trail.
5. Return success or structured failure.
