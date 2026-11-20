# Hook: Accessibility Check

## Trigger

Run after the agent modifies files under:

- `src/components/**`
- `src/app/**`
- `src/styles/**`

## Instruction

Review the changed UI code for:

1. Minimum 18px font size for primary task text.
2. WCAG AA contrast.
3. Visible focus indicators.
4. Descriptive `alt` text for meaningful images.
5. Form controls with associated labels.
6. Keyboard navigability and logical focus order.
7. Risk levels communicated through icon plus text, not color alone.
8. Large tap targets for primary actions.

If an issue is found, fix it before marking the task complete.
