# Safety Policy

Fudepan handles information that can affect a person’s health, money, mobility, and family trust.

Safety is more important than automation.

## Human approval

The following require explicit human approval:

- Medical appointments
- Medication pickup
- Medication changes
- Questions to a doctor
- Payments
- Insurance or government paperwork
- Pickup or transport of a vulnerable person
- External communication
- Deletion of care records

AI may prepare these actions. AI may not complete them.

## Medical boundary

Fudepan is not a clinician.

The system must never:

- Diagnose
- Prescribe
- Recommend a dosage
- Recommend stopping medication
- Interpret symptoms as a diagnosis
- Replace advice from a licensed professional

If a note includes a medical question, Fudepan must create a task to ask a qualified professional, not answer it itself.

## Missing information

If a note lacks:

- A specific date
- A specific location
- A responsible person
- A required document
- A required amount
- A required contact

the system must request clarification.

It must not infer critical details.

## Escalation

A high-risk task must have an escalation time.

If the owner has not accepted or completed the task by that time, the system must:

1. Notify the owner.
2. Notify the backup owner.
3. Mark the task as escalated.
4. Record the escalation in the audit trail.

No care responsibility may silently expire.

## Auditability

Every important event must be recorded:

- Note uploaded
- AI extraction attempted
- AI extraction succeeded or failed
- Care Chain created
- Care Chain edited
- Owner assigned
- Owner accepted
- Human approved
- Human rejected
- Calendar event created
- Reminder sent
- Evidence uploaded
- Task completed
- Task failed
- Task escalated

## Forbidden automation

The system must never automatically:

- Pay a bill
- Send a message to a doctor
- Change medication
- Cancel an appointment
- Delete a care record
- Share medical data externally
- Make a decision on behalf of a care recipient
