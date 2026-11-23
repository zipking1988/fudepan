/**
 * Escalation plan (family-shared-care design, "Escalation changes").
 * Pure TypeScript: no I/O, no clock. It is the oracle for the SQL function
 * `escalate_due_parts` and returns data only: who to remind and which audit
 * event to record. Requirements 8.13, 12.1, 12.2, 12.3, 12.6-12.12, 12.14.
 */
import { isHighRiskPart } from "@/lib/care/rules/approval";
import type { ESCALATION_LEDGER_KEY } from "@/lib/care/rules/defaults";
import type { MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

export type DeadlineKind = "respond_by" | "task_due";

/**
 * One row of the escalation ledger. Fields follow `ESCALATION_LEDGER_KEY`
 * (care_step_id, deadline_kind, deadline_at), decision D-3.
 */
export type EscalationLedgerEntry = {
  careStepId: string;
  deadlineKind: DeadlineKind;
  deadlineAt: Date;
};

export type EscalationPlan = {
  careStepId: string;
  householdId: string;
  deadlineKind: DeadlineKind;
  deadlineAt: Date;
  /** Progress_Status to write. Approval_State is never part of a plan (12.9). */
  newStatus: "escalated";
  /** Member ids that get an In_App_Reminder. */
  reminderRecipients: string[];
  /** Audit event to record in the same transaction as the ledger row. */
  auditEvent: { type: "part.escalated"; payload: { reason: DeadlineKind } };
};

const CLOSED_STATUSES: readonly string[] = ["completed", "cancelled", "failed"];

/** Ledger key per D-3, as a string. Kept in step with `ESCALATION_LEDGER_KEY`. */
export function escalationLedgerKey(entry: EscalationLedgerEntry): string {
  const fields: Record<(typeof ESCALATION_LEDGER_KEY)[number], string> = {
    care_step_id: entry.careStepId,
    deadline_kind: entry.deadlineKind,
    deadline_at: String(entry.deadlineAt.getTime()),
  };
  return [fields.care_step_id, fields.deadline_kind, fields.deadline_at].join("|");
}

function unique(ids: Array<string | null>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (id !== null && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Parts that should escalate now, one plan per (Part, deadline kind, deadline value)
 * not yet in the ledger.
 *
 * - Only High_Risk_Parts (12.10) that are not completed, cancelled, or failed
 *   (12.11, 12.12). A failed Part is checked again once a Reopen sets it to
 *   `in_progress`.
 * - Respond-by: `human_confirmed` Respond_By_Time reached and no Owner (12.1, 12.8).
 *   Recipients: every active Primary_Caregiver plus the Backup_Owner.
 * - Task-due: `human_confirmed` Task_Due_Time reached (12.2, 12.8). Recipients:
 *   Owner and Backup_Owner.
 * - Model-suggested times are ignored. Legacy `due_at` and `escalation_at` are not
 *   inputs at all (12.6, 12.7).
 * - A deadline value already in the ledger is skipped (12.3, D-3). A Reopen with
 *   the same Task_Due_Time does not escalate again; a new confirmed value does.
 *
 * `members` supplies the Primary_Caregivers for respond-by reminders. Members that
 * are unknown, inactive, or from another household never receive a reminder.
 */
export function escalationCandidates(
  parts: readonly PartSnapshot[],
  ledger: readonly EscalationLedgerEntry[],
  now: Date,
  members: readonly MemberSnapshot[] = [],
): EscalationPlan[] {
  const done = new Set(ledger.map(escalationLedgerKey));
  const plans: EscalationPlan[] = [];

  for (const part of parts) {
    if (!isHighRiskPart(part)) continue;
    if (CLOSED_STATUSES.includes(part.legacyStatus)) continue;

    const eligible = (memberId: string): boolean => {
      const found = members.find((m) => m.memberId === memberId);
      if (!found) return false;
      return found.isActive && found.householdId === part.householdId;
    };

    const add = (kind: DeadlineKind, deadlineAt: Date, recipients: Array<string | null>) => {
      const key = escalationLedgerKey({ careStepId: part.id, deadlineKind: kind, deadlineAt });
      if (done.has(key)) return;
      done.add(key);
      plans.push({
        careStepId: part.id,
        householdId: part.householdId,
        deadlineKind: kind,
        deadlineAt,
        newStatus: "escalated",
        reminderRecipients: unique(recipients).filter(eligible),
        auditEvent: { type: "part.escalated", payload: { reason: kind } },
      });
    };

    const respondBy = part.respondBy;
    if (
      respondBy &&
      respondBy.provenance === "human_confirmed" &&
      respondBy.at.getTime() <= now.getTime() &&
      part.ownerId === null
    ) {
      const caregivers = members
        .filter(
          (m) =>
            m.role === "primary_caregiver" && m.isActive && m.householdId === part.householdId,
        )
        .map((m) => m.memberId);
      add("respond_by", respondBy.at, [...caregivers, part.backupOwnerId]);
    }

    const taskDue = part.taskDue;
    if (
      taskDue &&
      taskDue.provenance === "human_confirmed" &&
      taskDue.at.getTime() <= now.getTime()
    ) {
      add("task_due", taskDue.at, [part.ownerId, part.backupOwnerId]);
    }
  }

  return plans;
}
