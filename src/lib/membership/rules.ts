/**
 * Authorization and last-primary rules for membership actions (family-app-demo-parity design,
 * "Pure modules"). Pure TypeScript: no I/O. Mirrors the checks the SQL functions make after
 * `private.lock_active_members`.
 */
import { isHouseholdRole, type HouseholdRole } from "@/lib/households/membership";

export type MemberRecord = {
  id: string;
  userId: string;
  householdId: string;
  role: HouseholdRole;
  isActive: boolean;
};

export type MembershipAction =
  | { kind: "create_invite"; householdId: string }
  | { kind: "revoke_invite"; householdId: string }
  | { kind: "change_role"; householdId: string; targetMemberId: string; newRole: HouseholdRole }
  | { kind: "deactivate"; householdId: string; targetMemberId: string }
  | { kind: "leave"; householdId: string }
  | { kind: "rename"; householdId: string; targetMemberId: string };

export type GuardRefusal =
  | "not_found"
  | "not_primary_caregiver"
  | "not_self"
  | "self_target"
  | "last_primary_caregiver"
  | "invalid_input";

export const DISPLAY_NAME_MAX = 40;

/** A display name is valid when its trimmed length is 1 to 40 characters (code points, as Postgres counts). */
export function isValidDisplayName(value: string): boolean {
  const length = Array.from(value.trim()).length;
  return length >= 1 && length <= DISPLAY_NAME_MAX;
}

function activeActor(
  actorUserId: string,
  members: readonly MemberRecord[],
  householdId: string,
): MemberRecord | undefined {
  return members.find((m) => m.userId === actorUserId && m.householdId === householdId && m.isActive);
}

function activePrimaryCount(members: readonly MemberRecord[], householdId: string): number {
  return members.filter((m) => m.householdId === householdId && m.isActive && m.role === "primary_caregiver")
    .length;
}

/**
 * True when the action takes primary_caregiver away from an active primary and no other active
 * primary remains in the household. Actions that do not touch a primary never return true.
 */
export function wouldLeaveNoPrimary(members: readonly MemberRecord[], action: MembershipAction): boolean {
  let target: MemberRecord | undefined;
  if (action.kind === "change_role") {
    if (action.newRole === "primary_caregiver") return false;
    target = members.find((m) => m.id === action.targetMemberId && m.householdId === action.householdId);
  } else if (action.kind === "deactivate") {
    target = members.find((m) => m.id === action.targetMemberId && m.householdId === action.householdId);
  } else {
    return false;
  }
  if (!target || !target.isActive || target.role !== "primary_caregiver") return false;
  return activePrimaryCount(members, action.householdId) <= 1;
}

/** `leave` has no target id: the actor's own row is the target. */
function leaveWouldLeaveNoPrimary(actor: MemberRecord, members: readonly MemberRecord[]): boolean {
  return actor.role === "primary_caregiver" && activePrimaryCount(members, actor.householdId) <= 1;
}

/**
 * Checks one action against the current member rows. An actor without an active row in the
 * action's household gets `not_found`, the same refusal as a missing row, so no household data leaks.
 */
export function guardMembershipAction(
  actorUserId: string,
  members: readonly MemberRecord[],
  action: MembershipAction,
): { ok: true } | { ok: false; refusal: GuardRefusal } {
  const actor = activeActor(actorUserId, members, action.householdId);
  if (!actor) return { ok: false, refusal: "not_found" };
  const refuse = (refusal: GuardRefusal) => ({ ok: false as const, refusal });
  const isPrimary = actor.role === "primary_caregiver";

  switch (action.kind) {
    case "create_invite":
    case "revoke_invite":
      return isPrimary ? { ok: true } : refuse("not_primary_caregiver");
    case "rename":
      return action.targetMemberId === actor.id ? { ok: true } : refuse("not_self");
    case "leave":
      return leaveWouldLeaveNoPrimary(actor, members) ? refuse("last_primary_caregiver") : { ok: true };
    case "change_role": {
      if (!isPrimary) return refuse("not_primary_caregiver");
      if (!isHouseholdRole(action.newRole)) return refuse("invalid_input");
      const target = members.find(
        (m) => m.id === action.targetMemberId && m.householdId === action.householdId && m.isActive,
      );
      if (!target) return refuse("not_found");
      return wouldLeaveNoPrimary(members, action) ? refuse("last_primary_caregiver") : { ok: true };
    }
    case "deactivate": {
      if (!isPrimary) return refuse("not_primary_caregiver");
      const target = members.find(
        (m) => m.id === action.targetMemberId && m.householdId === action.householdId && m.isActive,
      );
      if (!target) return refuse("not_found");
      if (target.id === actor.id) return refuse("self_target");
      return wouldLeaveNoPrimary(members, action) ? refuse("last_primary_caregiver") : { ok: true };
    }
  }
}
