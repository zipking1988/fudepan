# Hook: Guard Sensitive Files

## Trigger

Run before the agent reads or writes files matching:

- `.env`
- `.env.*`
- `**/secrets/**`
- `supabase/migrations/**`
- `**/*.pem`
- `**/*.key`

## Instruction

Before allowing the operation:

1. Identify whether the file contains credentials, private keys, database connection strings, or migration SQL.
2. If it is `.env`, `.env.*`, a private key, or a secrets directory file, block the action and instruct the agent to use `.env.example` instead.
3. If it is a Supabase migration, require the user to explicitly confirm the schema change.
4. Never print secret values, connection strings, tokens, or key material into chat, logs, tests, or documentation.
5. Recommend adding new secret names to `.env.example` with placeholder values only.
