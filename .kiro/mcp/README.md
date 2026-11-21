# Fudepan MCP Tools

MCP tools execute only human-approved actions.

ai& understands the handwritten note. Kiro MCP turns approved intent into controlled real-world actions.

## Tool principles

1. Never execute a high-risk action without approval.
2. Always write an audit event before and after execution.
3. Return structured results.
4. Fail safely and visibly.
5. Never expose secrets to the client.
6. Never act outside the current household.

## Available tools

- `calendar.create_event`
- `notifications.send_reminder`
- `notifications.send_escalation`
- `household.get_members`
- `household.get_responsibility_map`
- `household.get_pending_tasks`
- `household.record_execution_evidence`
