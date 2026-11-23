/**
 * English words for the old `/care` actions only (family-shared-care design,
 * "Rerouting the old /care actions"). Old pages stay English.
 *
 * Refusal text comes from the dictionary. The outcome messages below keep the old
 * "step" wording, because the old pages and their tests use it.
 * No diagnosis, dosage, or medication names appear in any message.
 */
import type { PartActionMessageKey } from "@/lib/care/part-actions";
import { en } from "@/lib/i18n/en";

/** Refusal text now lives in the dictionary (`src/lib/i18n/en.ts`); the old actions read it from there. */
export function oldActionMessage(key: PartActionMessageKey): string {
  return en[key];
}

export const OLD_EVIDENCE_TEXT_INVALID = "Evidence text is required (max 2000 characters).";

/** Shown when a completion was recorded as "evidence still needed" (not an error). */
export function evidenceStillNeededMessage(missing: readonly string[] | undefined): string {
  const list = (missing ?? []).filter((m) => m.length > 0);
  return list.length > 0
    ? `Not done yet. Evidence is still needed: ${list.join(", ")}.`
    : "Not done yet. Evidence is still needed.";
}

export const OLD_OUTCOME_MESSAGES = {
  approved: "Step confirmed. It is now approved for action.",
  rejected: "Step turned down.",
  completed: "Step marked as completed.",
  evidenceSaved: "Evidence saved with this step.",
  nothingToChange: "Nothing to change.",
  claimed: "You are now responsible for this step.",
  released: "You are no longer responsible for this step.",
  assignmentRequested: "Request sent. The person becomes responsible only after they accept.",
  handoverRequested: "Handover request sent. You stay responsible until they accept.",
  volunteered: "You are now the backup for this step.",
  backupRequested: "Backup request sent. The person becomes the backup only after they accept.",
} as const;
