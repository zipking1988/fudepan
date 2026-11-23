/**
 * Claim and release rules (family-shared-care design, "Pure rule module").
 * Pure TypeScript: no I/O, no clock (callers pass `now`). Mirrors the plpgsql
 * Action_Guard. Requirements 5.1, 5.4, 5.5, 5.13, 6.1-6.4, 6.6, 6.7, 7.1, 7.2,
 * 9.22, 21.2, 21.4.
 *
 * A Claim only ever comes from an explicit act by the claiming Member. These
 * functions take no ai& output (Suggested_Role, Person_To_Ask) as input, so
 * none of it can create a Claim (Requirement 5.3).
 */
import type { CareCategory } from "@/lib/ai/schema";
import { RELEASE_WINDOW_HOURS } from "@/lib/care/rules/defaults";
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

export { isHighRiskPart };

const TRAVEL_CATEGORIES: readonly CareCategory[] = ["appointment", "transport"];

const ROLE_COLUMN = {
  owner: "ownerId",
  driver: "driverId",
  companion: "companionId",
} as const satisfies Record<HelperRole, keyof PartSnapshot>;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Requirements 6.1, 6.7. The Owner Claim is always offered. Driver and
 * Companion are offered only on `appointment` and `transport` Parts, never for
 * shopping or medicine pickup.
 */
export function helperRolesOffered(part: Pick<PartSnapshot, "careCategory">): HelperRole[] {
  return TRAVEL_CATEGORIES.includes(part.careCategory)
    ? ["owner", "driver", "companion"]
    : ["owner"];
}

/**
 * The Member currently holding `role` on the Part, or null. Callers use this to
 * name the holder in the `already_claimed` message (Requirement 5.4).
 */
export function currentHolder(part: PartSnapshot, role: HelperRole): string | null {
  return part[ROLE_COLUMN[role]];
}

function isClosed(part: Pick<PartSnapshot, "legacyStatus">): boolean {
  return part.legacyStatus === "completed" || part.legacyStatus === "cancelled";
}

/**
 * Requirement 9.22. A change of Actual_Performer on a High_Risk_Part resets
 * `approved` to `pending`. `approvalRequired` is never touched (5.5).
 */
function withApprovalTransition(part: PartSnapshot): PartSnapshot {
  if (!isHighRiskPart(part)) return part;
  const current = effectiveApprovalState(part);
  const next = nextApprovalStateOnChange(current, "people");
  return next === current ? part : { ...part, storedApprovalState: next };
}

/**
 * Requirements 5.1, 5.4, 5.5, 5.13, 6.2-6.4, 9.22. Returns the Part with
 * `actor` in `role`. The same Member may hold several roles (6.4). A role
 * already held (even by the actor) is refused with `already_claimed`.
 */
export function decideClaim(
  part: PartSnapshot,
  actor: MemberSnapshot,
  role: HelperRole,
): Decision<PartSnapshot> {
  if (!actor.isActive || actor.householdId !== part.householdId) {
    return { ok: false, code: "part_not_found" };
  }
  if (actor.role === "care_recipient") return { ok: false, code: "recipient_read_only" };
  if (isClosed(part)) return { ok: false, code: "part_closed" };
  if (!helperRolesOffered(part).includes(role)) return { ok: false, code: "role_not_offered" };
  if (currentHolder(part, role) !== null) return { ok: false, code: "already_claimed" };

  const claimed: PartSnapshot = { ...part, [ROLE_COLUMN[role]]: actor.memberId };
  return { ok: true, value: withApprovalTransition(claimed) };
}

/**
 * Requirement 7.2. A High_Risk_Part with a `human_confirmed` Task_Due_Time that
 * is within the next RELEASE_WINDOW_HOURS or already past cannot be released.
 * A `model_suggested` time never blocks.
 */
function isReleaseBlocked(part: PartSnapshot, now: Date): boolean {
  if (!isHighRiskPart(part)) return false;
  if (part.taskDue === null || part.taskDue.provenance !== "human_confirmed") return false;
  return part.taskDue.at.getTime() <= now.getTime() + RELEASE_WINDOW_HOURS * HOUR_MS;
}

/**
 * Requirements 7.1, 7.2, 9.22, 21.4. Only the current holder of `role` may
 * release it. When blocked, the holder keeps the role until another Member
 * accepts a Handover.
 */
export function decideRelease(
  part: PartSnapshot,
  actor: MemberSnapshot,
  role: HelperRole,
  now: Date,
): Decision<PartSnapshot> {
  if (!actor.isActive || actor.householdId !== part.householdId) {
    return { ok: false, code: "part_not_found" };
  }
  if (actor.role === "care_recipient") return { ok: false, code: "recipient_read_only" };
  if (isClosed(part)) return { ok: false, code: "part_closed" };
  if (currentHolder(part, role) !== actor.memberId) return { ok: false, code: "not_holder" };
  if (isReleaseBlocked(part, now)) return { ok: false, code: "release_blocked_due_soon" };

  const released: PartSnapshot = { ...part, [ROLE_COLUMN[role]]: null };
  return { ok: true, value: withApprovalTransition(released) };
}
