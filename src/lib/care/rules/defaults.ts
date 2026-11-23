/**
 * Pending defaults of the family-shared-care design. Each one lives in exactly
 * one named constant so it can be changed in one place. The SQL side mirrors
 * them in single private helpers (see tasks 8.1).
 */

/**
 * D-1. Default pending confirmation.
 * Pending Assignments and Backup_Requests expire this many hours after the request.
 */
export const REQUEST_EXPIRY_HOURS = 24;

/**
 * D-2. Default pending confirmation.
 * Who may Reopen a failed Part or create a Backup_Request: the Part's Owner or
 * an active Primary_Caregiver.
 */
export const REOPEN_AND_BACKUP_ROLES = ["owner", "primary_caregiver"] as const;

export type ReopenAndBackupRole = (typeof REOPEN_AND_BACKUP_ROLES)[number];

/**
 * D-3. Default pending confirmation.
 * The escalation ledger is unique per Part, deadline kind, and deadline value.
 * After a Reopen, a Part already escalated for a Task_Due_Time escalates again
 * only after a new Task_Due_Time is confirmed. To change the rule, add the
 * Reopen time to this key (and to the unique constraint on `step_escalations`).
 */
export const ESCALATION_LEDGER_KEY = ["care_step_id", "deadline_kind", "deadline_at"] as const;

/**
 * D-4. Default pending confirmation.
 * A completed Part is labelled "Done" everywhere. This is the label key.
 */
export const COMPLETED_LABEL_KEY = "done";

/**
 * D-7. Default pending confirmation.
 * When a confirmed Task_Due_Time is already past at Handover time, the Handover
 * expires 24 hours after the request, so an overdue Part can still be handed over.
 */
export const HANDOVER_PAST_DUE_FALLBACK = "24h";

/**
 * D-6. Default pending confirmation.
 * Whether the old `assignStepOwner` action may clear a Backup_Owner. Off: clearing
 * returns "Backup changes need the backup's agreement".
 */
export const ALLOW_LEGACY_BACKUP_CLEAR = false;

/**
 * A3. Default pending confirmation.
 * A High_Risk_Part with a confirmed Task_Due_Time within this many hours (or
 * past) cannot be released; it must be handed over.
 */
export const RELEASE_WINDOW_HOURS = 24;
