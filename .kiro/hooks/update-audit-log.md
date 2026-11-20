# Hook: Update Audit Log

## Trigger

Run after the agent modifies:

- `src/lib/audit.ts`
- `src/server/api/tasks/**`
- `src/lib/workflow/**`
- `src/lib/notifications/**`
- `src/lib/calendar/**`

## Instruction

Verify that every state-changing workflow writes an audit event containing:

- `task_id`
- `actor_id`
- `event_type`
- `payload`
- `created_at`

Required audit events include:

- `note_created`
- `task_extracted`
- `task_updated`
- `task_confirmation_requested`
- `task_approved`
- `task_rejected`
- `task_completed`
- `task_cancelled`
- `calendar_event_created`
- `notification_sent`

Reject implementations that silently mutate task state without an audit event.
