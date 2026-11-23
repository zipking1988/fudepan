/**
 * Request rules (family-shared-care design, "Pure rule module"): Assignment,
 * Handover, and Backup_Request creation and answers. Pure TypeScript: no I/O,
 * no clock (callers pass `now`). Mirrors the plpgsql Action_Guard.
 * Requirements 5.9-5.19, 8.1-8.13, 21.1, 21.5, 21.6.
 *
 * The holder of a role never changes until the receiving Member accepts
 * (5.9, 5.14, 8.3). These functions return a new Part value; they never mutate.
 */
import {
  HANDOVER_PAST_DUE_FALLBACK,
  REOPEN_AND_BACKUP_ROLES,
  REQUEST_EXPIRY_HOURS,
} from "@/lib/care/rules/defaults";
import {
  effectiveApprovalState,
  isHighRiskPart,
  nextApprovalStateOnChange,
} from "@/lib/care/rules/approval";
import type {
  Decision,
  HelperRole,
  MemberSnapshot,
  PartSnapshot,
} from "@/lib/care/rules/types";

const HOUR_MS = 60 * 60 * 1000;

export type RequestKind = "assignment" | "handover" | "backup";

export type RequestStatus = "pending" | "accepted" | "declined" | "expired";

/** How an expiry time was chosen (`expiry_rule` in the handover.requested payload). */
export type ExpiryRule = "task_due" | "24h";

export type CareRequestSnapshot = {
  id: string;
  careStepId: string;
  householdId: string;
  kind: RequestKind;
  /** `owner` for an Assignment, the handed-over role for a Handover, null for a Backup_Request. */
  helperRole: HelperRole | null;
  requesterId: string;
  receiverId: string;
  status: RequestStatus;
  expiresAt: Date;
};

export type RequestPlan = {
  kind: RequestKind;
  helperRole: HelperRole | null;
  expiresAt: Date;
  expiryRule: ExpiryRule;
};

const ROLE_COLUMN = {
  owner: "ownerId",
  driver: "driverId",
  companion: "companionId",
} as const satisfies Record<HelperRole, keyof PartSnapshot>;

function fallbackHours(): number {
  const parsed = Number.parseInt(HANDOVER_PAST_DUE_FALLBACK, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : REQUEST_EXPIRY_HOURS;
}

/**
 * Requirements 8.10, D-7. A `human_confirmed` Task_Due_Time later than the
 * request time is the expiry. Otherwise (no time, model-suggested, or already
 * past) the Handover expires 24 hours after the request.
 */
export function handoverExpiryWithRule(
  part: Pick<PartSnapshot, "taskDue">,
  requestedAt: Date,
): { expiresAt: Date; expiryRule: ExpiryRule } {
  const due = part.taskDue;
  if (
    due !== null &&
    due.provenance === "human_confirmed" &&
    due.at.getTime() > requestedAt.getTime()
  ) {
    return { expiresAt: new Date(due.at.getTime()), expiryRule: "task_due" };
  }
  return {
    expiresAt: new Date(requestedAt.getTime() + fallbackHours() * HOUR_MS),
    expiryRule: "24h",
  };
}

/** Handover_Expiry_Time (glossary), Requirement 8.10. */
export function handoverExpiry(part: Pick<PartSnapshot, "taskDue">, requestedAt: Date): Date {
  return handoverExpiryWithRule(part, requestedAt).expiresAt;
}

/** D-1. Pending Assignments and Backup_Requests expire 24 hours after the request. */
export function requestExpiry(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + REQUEST_EXPIRY_HOURS * HOUR_MS);
}

/**
 * Requirements 8.2, 5.14. A receiver is active, in the Part's Household, not a
 * Care_Recipient, and not the requester.
 */
export function isEligibleReceiver(
  part: Pick<PartSnapshot, "householdId">,
  requester: Pick<MemberSnapshot, "memberId">,
  candidate: MemberSnapshot,
): boolean {
  return (
    candidate.isActive &&
    candidate.householdId === part.householdId &&
    candidate.role !== "care_recipient" &&
    candidate.memberId !== requester.memberId
  );
}

export function eligibleReceivers(
  part: Pick<PartSnapshot, "householdId">,
  requester: Pick<MemberSnapshot, "memberId">,
  members: readonly MemberSnapshot[],
): MemberSnapshot[] {
  return members.filter((m) => isEligibleReceiver(part, requester, m));
}

function isClosed(part: Pick<PartSnapshot, "legacyStatus">): boolean {
  return part.legacyStatus === "completed" || part.legacyStatus === "cancelled";
}

function refuseIfNotActiveWriter(part: PartSnapshot, actor: MemberSnapshot): Decision<never> | null {
  if (!actor.isActive || actor.householdId !== part.householdId) {
    return { ok: false, code: "part_not_found" };
  }
  if (actor.role === "care_recipient") return { ok: false, code: "recipient_read_only" };
  if (isClosed(part)) return { ok: false, code: "part_closed" };
  return null;
}

function hasPending(
  pending: readonly CareRequestSnapshot[],
  part: PartSnapshot,
  kind: RequestKind,
  helperRole: HelperRole | null,
): boolean {
  return pending.some(
    (r) =>
      r.status === "pending" &&
      r.careStepId === part.id &&
      r.kind === kind &&
      r.helperRole === helperRole,
  );
}

/**
 * Requirements 5.7, 5.9, 5.12, 21.1. Only an active Primary_Caregiver may start
 * an Assignment. Nothing changes on the Part until the receiver accepts.
 */
export function decideAssignmentRequest(
  part: PartSnapshot,
  actor: MemberSnapshot,
  receiver: MemberSnapshot | null,
  pending: readonly CareRequestSnapshot[],
  now: Date,
): Decision<RequestPlan> {
  const refused = refuseIfNotActiveWriter(part, actor);
  if (refused) return refused;
  if (actor.role !== "primary_caregiver") return { ok: false, code: "not_primary_caregiver" };
  if (receiver === null || !isEligibleReceiver(part, actor, receiver)) {
    return { ok: false, code: "receiver_not_eligible" };
  }
  if (hasPending(pending, part, "assignment", "owner")) {
    return { ok: false, code: "request_pending" };
  }
  return {
    ok: true,
    value: {
      kind: "assignment",
      helperRole: "owner",
      expiresAt: requestExpiry(now),
      expiryRule: "24h",
    },
  };
}

/**
 * Requirements 8.1-8.3, 8.10, 21.1. Only the current holder of `role` may ask
 * for a Handover. The holder keeps the role while it is pending.
 */
export function decideHandoverRequest(
  part: PartSnapshot,
  actor: MemberSnapshot,
  role: HelperRole,
  receiver: MemberSnapshot | null,
  pending: readonly CareRequestSnapshot[],
  now: Date,
): Decision<RequestPlan> {
  const refused = refuseIfNotActiveWriter(part, actor);
  if (refused) return refused;
  if (part[ROLE_COLUMN[role]] !== actor.memberId) return { ok: false, code: "not_holder" };
  if (receiver === null || !isEligibleReceiver(part, actor, receiver)) {
    return { ok: false, code: "receiver_not_eligible" };
  }
  if (hasPending(pending, part, "handover", role)) {
    return { ok: false, code: "request_pending" };
  }
  const { expiresAt, expiryRule } = handoverExpiryWithRule(part, now);
  return { ok: true, value: { kind: "handover", helperRole: role, expiresAt, expiryRule } };
}

/**
 * D-2, Requirements 5.14, 21.5. The Part's Owner or an active Primary_Caregiver
 * may name another Member as Backup_Owner. The current backup stays until the
 * receiver accepts. The Owner cannot also be the backup.
 */
export function decideBackupRequest(
  part: PartSnapshot,
  actor: MemberSnapshot,
  receiver: MemberSnapshot | null,
  pending: readonly CareRequestSnapshot[],
  now: Date,
): Decision<RequestPlan> {
  const refused = refuseIfNotActiveWriter(part, actor);
  if (refused) return refused;
  const allowed = REOPEN_AND_BACKUP_ROLES.some((r) =>
    r === "owner" ? part.ownerId !== null && part.ownerId === actor.memberId : actor.role === r,
  );
  if (!allowed) return { ok: false, code: "not_allowed_backup_request" };
  if (
    receiver === null ||
    !isEligibleReceiver(part, actor, receiver) ||
    receiver.memberId === part.ownerId
  ) {
    return { ok: false, code: "receiver_not_eligible" };
  }
  if (hasPending(pending, part, "backup", null)) return { ok: false, code: "request_pending" };
  return {
    ok: true,
    value: { kind: "backup", helperRole: null, expiresAt: requestExpiry(now), expiryRule: "24h" },
  };
}

/**
 * Requirement 5.17. A Member volunteers as Backup_Owner directly. Refused if a
 * backup is already set, or if the volunteer is the Owner.
 */
export function decideVolunteerBackup(
  part: PartSnapshot,
  actor: MemberSnapshot,
): Decision<PartSnapshot> {
  const refused = refuseIfNotActiveWriter(part, actor);
  if (refused) return refused;
  if (part.ownerId !== null && part.ownerId === actor.memberId) {
    return { ok: false, code: "invalid_input" };
  }
  if (part.backupOwnerId !== null) return { ok: false, code: "already_claimed" };
  return { ok: true, value: { ...part, backupOwnerId: actor.memberId } };
}

export type RequestResponseValue =
  /** Receiver accepted: `part` carries the new holder and any approval reset. */
  | { outcome: "accepted"; requestStatus: "accepted"; part: PartSnapshot; approvalReset: boolean }
  /** Receiver declined: `part` is unchanged. */
  | { outcome: "declined"; requestStatus: "declined"; part: PartSnapshot }
  /**
   * Committed refusal (Requirement 8.11): the caller must save the request as
   * `expired` and write the not-accepted events. `part` is unchanged.
   */
  | { outcome: "expired"; requestStatus: "expired"; part: PartSnapshot }
  /** The requester no longer holds the role: closed as declined by the system. */
  | {
      outcome: "declined";
      requestStatus: "declined";
      part: PartSnapshot;
      reason: "holder_changed";
    };

function withPeopleApprovalTransition(part: PartSnapshot): PartSnapshot {
  if (!isHighRiskPart(part)) return part;
  const current = effectiveApprovalState(part);
  const next = nextApprovalStateOnChange(current, "people");
  return next === current ? part : { ...part, storedApprovalState: next };
}

/**
 * Requirements 5.10, 5.11, 5.15, 5.16, 8.4-8.6, 8.9, 8.11, 8.12, 21.6.
 *
 * Only the receiver may answer. Accepting at or after `expiresAt` returns an
 * `expired` RESULT (ok: true) that the caller must save; it is not a refusal to
 * throw, because raising would roll back the expiry. Accepting moves only the
 * requested role (or `backupOwnerId`), and on a High_Risk_Part resets approval
 * for Owner/Driver/Companion changes. Declining changes no holder.
 */
export function decideRequestResponse(
  request: CareRequestSnapshot,
  part: PartSnapshot,
  actor: MemberSnapshot,
  now: Date,
  accept: boolean,
): Decision<RequestResponseValue> {
  if (
    request.careStepId !== part.id ||
    request.householdId !== part.householdId ||
    request.receiverId !== actor.memberId ||
    actor.householdId !== part.householdId
  ) {
    return { ok: false, code: "request_not_found" };
  }
  if (actor.role === "care_recipient") return { ok: false, code: "recipient_read_only" };
  if (request.status !== "pending") return { ok: false, code: "request_not_pending" };
  if (isClosed(part)) return { ok: false, code: "part_closed" };

  if (!accept) {
    return { ok: true, value: { outcome: "declined", requestStatus: "declined", part } };
  }

  if (now.getTime() >= request.expiresAt.getTime()) {
    return { ok: true, value: { outcome: "expired", requestStatus: "expired", part } };
  }
  if (!actor.isActive) return { ok: false, code: "receiver_not_eligible" };

  if (request.kind === "backup") {
    if (part.ownerId !== null && part.ownerId === actor.memberId) {
      return { ok: false, code: "receiver_not_eligible" };
    }
    return {
      ok: true,
      value: {
        outcome: "accepted",
        requestStatus: "accepted",
        part: { ...part, backupOwnerId: actor.memberId },
        approvalReset: false,
      },
    };
  }

  const role: HelperRole = request.kind === "assignment" ? "owner" : (request.helperRole ?? "owner");
  const column = ROLE_COLUMN[role];

  if (request.kind === "handover" && part[column] !== request.requesterId) {
    return {
      ok: true,
      value: {
        outcome: "declined",
        requestStatus: "declined",
        part,
        reason: "holder_changed",
      },
    };
  }

  const moved: PartSnapshot = { ...part, [column]: actor.memberId };
  const holderChanged = part[column] !== actor.memberId;
  const next = holderChanged ? withPeopleApprovalTransition(moved) : moved;
  return {
    ok: true,
    value: {
      outcome: "accepted",
      requestStatus: "accepted",
      part: next,
      approvalReset: next.storedApprovalState !== moved.storedApprovalState,
    },
  };
}
