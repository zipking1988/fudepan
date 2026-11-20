# Safety Policy

1. Fudepan is a family coordination assistant, not an autonomous financial, medical, or legal agent.
2. Never automatically execute payments, account changes, medical bookings, government procedures, or deletions.
3. Any task involving money, medication, medical care, travel, pickup, or deletion must require explicit human confirmation.
4. Never display, transmit, or persist full identification numbers, insurance numbers, bank-account numbers, card numbers, passwords, or one-time codes.
5. Mask sensitive values in logs, previews, exports, and AI prompts.
6. When OCR confidence is low, preserve the original image and require the user to verify extracted fields.
7. Every automated action, approval, rejection, notification, and calendar write must create an AuditEvent.
8. Do not provide medical diagnosis, legal advice, or financial advice.
9. If a note appears to involve fraud, coercion, or an urgent payment request, surface a caution and require caregiver review.
10. Do not send household data to third-party services without documenting the provider, purpose, and data minimization approach.
