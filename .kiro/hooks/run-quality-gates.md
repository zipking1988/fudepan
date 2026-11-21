# Hook: Run Quality Gates

## Trigger

Run before declaring any implementation phase complete, before commit, and before deployment.

## Required commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Additional checks

- No API key appears in client-side code.
- No `.env` file is committed.
- No raw sensitive data appears in logs.
- All ai& calls occur server-side.
- All high-risk actions require approval.
- All AI outputs are schema-validated.
- All important state changes create audit events.
- Public demo URL responds successfully.
- `.kiro/` directory is present and complete.

## Rule

Do not mark a task complete if any quality gate fails.
