# Hook: Mask Sensitive Data

## Trigger

Run before:

- Writing application logs
- Writing error traces
- Sending analytics
- Displaying debug information
- Storing audit payload data that is not necessary in full

## Purpose

Prevent sensitive family and medical information from leaking into logs, analytics, error trackers, or public repositories.

## Data to mask

- Full name
- Address
- Phone number
- Email
- Date of birth
- Insurance number
- Government ID
- Bank account
- Credit card
- Medication name, unless necessary for the care workflow
- Medical condition
- Raw handwritten note text
- Raw image data

## Masking format

Use stable, reversible-only-in-database masking where appropriate:

```text
Insurance number: ****-****-1234
Medication: [REDACTED_MEDICATION]
Address: [REDACTED_ADDRESS]
```

## Rule

Never write raw sensitive content to:

- Browser console
- Vercel logs
- Error tracking services
- Analytics events
- Public repositories
- Client-side state
- URL query parameters
