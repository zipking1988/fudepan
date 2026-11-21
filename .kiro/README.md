# Fudepan Kiro Configuration

This `.kiro/` directory defines how Kiro participates in Fudepan.

Fudepan turns a handwritten household note into a safe, editable, and accountable care workflow.

## How Kiro is used

### Specs

`specs/fudepan-care-chain/` defines:

- The Care Chain domain model
- Human approval requirements
- Risk classification
- Audit requirements
- Acceptance criteria

### Steering

`steering/` defines the product constitution:

- Product principles
- Vercel + Supabase + ai& architecture
- ai& usage boundaries
- Safety policy
- Privacy policy
- Accessibility policy

### Hooks

`hooks/` enforce non-negotiable rules:

- Validate Care Chain schema
- Block high-risk auto-execution
- Require audit trails
- Mask sensitive data
- Check accessibility
- Run quality gates

### MCP

`mcp/` defines controlled agent tools:

- Calendar
- Notifications
- Household context
- Execution evidence

### Crew

`crew/care-concierge.md` defines a persistent agent that produces a daily household responsibility briefing.

## Core rule

ai& understands the note.

Kiro governs what may be done with that understanding.

Humans approve what matters.

## Non-negotiable product rule

No high-risk care action may be executed automatically.

AI may prepare it.

A human must approve it.

The system must record it.
