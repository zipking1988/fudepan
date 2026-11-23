/**
 * Translation of the old `assignStepOwner` input into new-flow operations
 * (family-shared-care design, "Old action" table; D-6). Pure TypeScript: no
 * I/O, no clock (callers pass `now`). Requirements 5.9-5.19, 18.5, 21.1-21.6.
 *
 * The result is a list of operations for the part action service to run
 * through the Action_Guard. Nothing here sets another Member as Owner or
 * Backup_Owner directly: every change of a person goes through a claim, an
 * Assignment, a Handover, a Backup_Request, or a volunteer act (5.19).
 *
 * All-or-nothing: if any requested change is refused, the whole translation is
 * refused and no operation is returned.
 */
import {
  decideAssignmentRequest,
  decideBackupRequest,
  decideHandoverRequest,
  decideVolunteerBackup,
  type CareRequestSnapshot,
} from "@/lib/care/rules/requests";
import { decideClaim, decideRelease } from "@/lib/care/rules/claims";
import type { Decision, MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

/**
 * D-6. Legacy callers cannot clear a Backup_Owner: the requirements define how
 * a backup is added, not how one is removed. Flip only after a
 * `withdraw_backup` function is confirmed.
 */
export const ALLOW_LEGACY_BACKUP_CLEAR: boolean = false;

/** Input of the old action. `backupOwnerId: undefined` means "leave the backup alone". */
export type OwnerAssignmentInput = {
  stepId: string;
  ownerId: string | null;
  backupOwnerId?: string | null;
};

export type OwnerAssignmentOperation =
  /** Actor claims the Owner role (claim_part, role owner). */
  | { type: "claim_part"; role: "owner" }
  /** Actor releases the Owner role (release_part, role owner). */
  | { type: "release_part"; role: "owner" }
  /** Primary_Caregiver asks `receiverId` to become Owner (request_assignment). */
  | { type: "request_assignment"; receiverId: string }
  /** Current Owner asks `receiverId` to take over (request_handover). */
  | { type: "request_handover"; role: "owner"; receiverId: string }
  /** Actor volunteers as Backup_Owner (volunteer_backup). */
  | { type: "volunteer_backup" }
  /** Owner or Primary_Caregiver asks `receiverId` to be Backup_Owner (request_backup). */
  | { type: "request_backup"; receiverId: string }
  /** Only produced when ALLOW_LEGACY_BACKUP_CLEAR is true (D-6). */
  | { type: "withdraw_backup" };

export type OwnerAssignmentContext = {
  /** Household members, used to find the receiver of a request. */
  members: readonly MemberSnapshot[];
  /** Pending requests on the Part, so a duplicate is refused. */
  pending?: readonly CareRequestSnapshot[];
  now: Date;
  /** Test seam for D-6; defaults to ALLOW_LEGACY_BACKUP_CLEAR. */
  allowLegacyBackupClear?: boolean;
};

type Step<T> = Decision<T>;

function translateOwner(
  part: PartSnapshot,
  targetId: string | null,
  actor: MemberSnapshot,
  ctx: OwnerAssignmentContext,
  pending: readonly CareRequestSnapshot[],
): Step<{ ops: OwnerAssignmentOperation[]; part: PartSnapshot }> {
  const current = part.ownerId;
  if (targetId === current) return { ok: true, value: { ops: [], part } };

  // Requirement 21.4: a cleared Owner becomes a release by the holder.
  if (targetId === null) {
    const released = decideRelease(part, actor, "owner", ctx.now);
    if (!released.ok) return released;
    return {
      ok: true,
      value: { ops: [{ type: "release_part", role: "owner" }], part: released.value },
    };
  }

  // Requirements 5.1, 21.2: the actor's own id is a claim, never a direct write.
  if (targetId === actor.memberId) {
    const claimed = decideClaim(part, actor, "owner");
    if (!claimed.ok) return claimed;
    return {
      ok: true,
      value: { ops: [{ type: "claim_part", role: "owner" }], part: claimed.value },
    };
  }

  const receiver = ctx.members.find((m) => m.memberId === targetId) ?? null;

  // Requirements 8.1, 21.3: the current Owner hands the role over.
  if (current !== null && current === actor.memberId) {
    const plan = decideHandoverRequest(part, actor, "owner", receiver, pending, ctx.now);
    if (!plan.ok) return plan;
    return {
      ok: true,
      value: { ops: [{ type: "request_handover", role: "owner", receiverId: targetId }], part },
    };
  }

  // Requirements 5.7, 5.9, 21.1: anyone else must be an active Primary_Caregiver.
  const plan = decideAssignmentRequest(part, actor, receiver, pending, ctx.now);
  if (!plan.ok) return plan;
  return {
    ok: true,
    value: { ops: [{ type: "request_assignment", receiverId: targetId }], part },
  };
}

function translateBackup(
  part: PartSnapshot,
  targetId: string | null | undefined,
  actor: MemberSnapshot,
  ctx: OwnerAssignmentContext,
  pending: readonly CareRequestSnapshot[],
): Step<OwnerAssignmentOperation[]> {
  if (targetId === undefined || targetId === part.backupOwnerId) {
    return { ok: true, value: [] };
  }

  if (targetId === null) {
    const allow = ctx.allowLegacyBackupClear ?? ALLOW_LEGACY_BACKUP_CLEAR;
    // D-6: "Backup changes need the backup's agreement."
    if (!allow) return { ok: false, code: "not_allowed_backup_request" };
    return { ok: true, value: [{ type: "withdraw_backup" }] };
  }

  // Requirements 5.17, 21.5: volunteering is the only way to set yourself.
  if (targetId === actor.memberId) {
    const volunteered = decideVolunteerBackup(part, actor);
    if (!volunteered.ok) return volunteered;
    return { ok: true, value: [{ type: "volunteer_backup" }] };
  }

  const receiver = ctx.members.find((m) => m.memberId === targetId) ?? null;
  const plan = decideBackupRequest(part, actor, receiver, pending, ctx.now);
  if (!plan.ok) return plan;
  return { ok: true, value: [{ type: "request_backup", receiverId: targetId }] };
}

/**
 * Turns the old action's input into new-flow operations, in the order they
 * must run (owner first, then backup). An empty list means nothing to do.
 * The backup change is judged against the Part as the owner operation would
 * leave it, so claiming and volunteering in one call is refused like it would
 * be in two.
 */
export function translateOwnerAssignment(
  current: PartSnapshot,
  input: OwnerAssignmentInput,
  actor: MemberSnapshot,
  context: OwnerAssignmentContext,
): Decision<OwnerAssignmentOperation[]> {
  const pending = context.pending ?? [];

  const owner = translateOwner(current, input.ownerId, actor, context, pending);
  if (!owner.ok) return owner;

  const backup = translateBackup(owner.value.part, input.backupOwnerId, actor, context, pending);
  if (!backup.ok) return backup;

  return { ok: true, value: [...owner.value.ops, ...backup.value] };
}
