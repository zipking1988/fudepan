# Hook: Validate Task Schema

## Trigger

Run after the agent modifies any of:

- `src/lib/task-schema.ts`
- `src/lib/risk-rules.ts`
- `src/lib/ai/parser.ts`
- `src/types/task.ts`
- `src/server/api/tasks/**`

## Instruction

Run the following checks and stop if any fail:

```bash
npm run typecheck
npm run test -- task-schema risk-rules parser
```

Verify that:

1. Every task has a valid category.
2. `medication`, `payment`, `appointment`, and `pickup` default to high risk.
3. High-risk tasks cannot transition directly to `confirmed`.
4. High-risk tasks require an approver ID and audit event.
5. Payment tasks never contain an executable payment action.
6. All dates are stored in ISO 8601 format.
7. Sensitive values are masked or rejected before persistence.
