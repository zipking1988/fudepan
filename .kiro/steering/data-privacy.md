# Data Privacy Steering

Fudepan processes sensitive family and care information.

## Data minimization

Collect only what is needed to create, review, approve, execute, and audit a Care Chain.

Do not collect or retain:

- Unnecessary biometric data
- Unnecessary location history
- Unnecessary contacts
- Unnecessary financial account details
- Unnecessary full medical records

## Sensitive data

Treat the following as sensitive:

- Full name
- Address
- Phone number
- Date of birth
- Insurance number
- Government ID
- Medication names
- Medical conditions
- Bank account information
- Payment information
- Handwritten note images

## Logging rules

Never log raw sensitive content.

Before logging:

- Mask names where possible
- Mask insurance and government IDs
- Mask medication names when not necessary for debugging
- Mask bank and payment data
- Mask addresses
- Remove image binary data
- Remove full prompt contents from client-visible errors

## ai& data handling

- Send only the minimum image and context needed.
- Call ai& only from the server.
- Do not send other households’ data.
- Do not use ai& output as a replacement for verified records.
- Store the ai& file reference only for audit purposes.
- Do not treat the ai& file ID as a permanent public image URL.

## Access control

- A user may access only households they belong to.
- Care recipients may have limited or read-only access.
- Professional caregivers may access only authorized households.
- Audit events must be immutable.
- Deletion must be explicit and audited.
