/**
 * Reference model of every membership SQL function (family-app-demo-parity design, "Data Models").
 * Pure TypeScript, no I/O. State, audit, feed, and reminder accounting follow the design's function
 * table, so property tests here describe what the plpgsql must do.
 *
 * Refusals model a raised P0001: the whole transaction rolls back, so the returned state is the input
 * state. Outcomes that must commit (expiry, `not_pending`, `unusable`) are returned, not raised.
 */
import type { ApprovalState } from "@/lib/care/rules/types";
import type { HouseholdRole } from "@/lib/households/membership";
import { membershipAuditPayload, type MembershipEventType } from "./audit-payload";
import { heldParts, type PartHolders, type RequestRef } from "./held-parts";
import type { InviteState } from "./invite-state";
import { effectiveInviteState } from "./invite-state";
import { INVITE_TTL_MS, PENDING_INVITE_CAP } from "./invite-token";
import { guardMembershipAction, isValidDisplayName, type MemberRecord, type MembershipAction } from "./rules";

export type ModelMember = MemberRecord & { displayName: string };
export type ModelHousehold = { id: string; name: string };

export type ModelInvite = {
  id: string;
  householdId: string;
  role: HouseholdRole;
  /** Stands in for the token hash. */
  token: string;
  createdByMemberId: string;
  createdAt: Date;
  expiresAt: Date;
  state: InviteState;
  acceptedByUserId: string | null;
  acceptedMemberId: string | null;
  acceptedAt: Date | null;
  revokedByMemberId: string | null;
  revokedAt: Date | null;
  expiredAt: Date | null;
};

export type ModelPart = PartHolders & { householdId: string; dueAt: Date | null };
export type ModelRequest = RequestRef & { householdId: string; kind: "assignment" | "handover" | "backup" };

export type ModelAudit = {
  type: string;
  actorType: "human" | "system";
  actorId: string | null;
  householdId: string;
  payload: Record<string, string>;
};
export type ModelFeed = {
  kind: string;
  householdId: string;
  partId: string | null;
  params: Record<string, string>;
};
export type ModelReminder = { kind: string; memberId: string; householdId: string; partId: string | null };

export type ModelState = {
  households: ModelHousehold[];
  members: ModelMember[];
  invites: ModelInvite[];
  parts: ModelPart[];
  requests: ModelRequest[];
  audit: ModelAudit[];
  feed: ModelFeed[];
  reminders: ModelReminder[];
};

export type ModelOp =
  | { kind: "create_household"; userId: string; householdName: string; displayName: string; householdId: string; memberId: string }
  | { kind: "create_invite"; householdId: string; actorUserId: string; role: HouseholdRole; inviteId: string; token: string }
  | { kind: "list_invites"; householdId: string; actorUserId: string }
  | { kind: "revoke_invite"; householdId: string; actorUserId: string; inviteId: string }
  | { kind: "preview_invite"; token: string }
  | { kind: "accept_invite"; token: string; userId: string; displayName: string; memberId: string }
  | { kind: "change_role"; householdId: string; actorUserId: string; memberId: string; role: HouseholdRole }
  | { kind: "deactivate"; householdId: string; actorUserId: string; memberId: string }
  | { kind: "leave"; householdId: string; actorUserId: string }
  | { kind: "rename"; householdId: string; actorUserId: string; displayName: string };

export type ModelResult = {
  state: ModelState;
  /** Success outcome, or the refusal code when `refused` is true. */
  outcome: string;
  /** True when the SQL function would raise P0001 (nothing changes). */
  refused: boolean;
  /** The jsonb the function returns (snake_case keys), `{}` for a refusal. */
  result: Record<string, unknown>;
};

export const emptyModelState = (): ModelState => ({
  households: [],
  members: [],
  invites: [],
  parts: [],
  requests: [],
  audit: [],
  feed: [],
  reminders: [],
});

const REASON_DEPARTED = "member_departed";

function refuse(state: ModelState, code: string): ModelResult {
  return { state, outcome: code, refused: true, result: {} };
}
function done(state: ModelState, outcome: string, result: Record<string, unknown> = {}): ModelResult {
  return { state, outcome, refused: false, result: { outcome, ...result } };
}

function auditMembership(
  s: ModelState,
  type: MembershipEventType,
  householdId: string,
  actorUserId: string | null,
  ids: Parameters<typeof membershipAuditPayload>[1],
) {
  s.audit.push({
    type,
    actorType: actorUserId === null ? "system" : "human",
    actorId: actorUserId,
    householdId,
    payload: membershipAuditPayload(type, ids),
  });
}

/** private.expire_overdue_invites: one system `invite.expired` event per newly expired invite. */
function expireOverdue(s: ModelState, householdId: string, now: Date): void {
  for (const inv of s.invites) {
    if (inv.householdId === householdId && inv.state === "pending" && now.getTime() >= inv.expiresAt.getTime()) {
      expireOne(s, inv, now);
    }
  }
}
function expireOne(s: ModelState, inv: ModelInvite, now: Date): void {
  inv.state = "expired";
  inv.expiredAt = now;
  auditMembership(s, "invite.expired", inv.householdId, null, { inviteId: inv.id, role: inv.role });
}

function activePrimaries(s: ModelState, householdId: string, excludeMemberId?: string): ModelMember[] {
  return s.members.filter(
    (m) => m.householdId === householdId && m.isActive && m.role === "primary_caregiver" && m.id !== excludeMemberId,
  );
}
function notifyPrimaries(s: ModelState, householdId: string, excludeMemberId: string, kind: string, partId: string | null) {
  for (const m of activePrimaries(s, householdId, excludeMemberId)) {
    s.reminders.push({ kind, memberId: m.id, householdId, partId });
  }
}

const HOLDER_FIELD = {
  owner: "ownerId",
  driver: "driverId",
  companion: "companionId",
  backup_owner: "backupOwnerId",
} as const;

/** private.release_departing_member. Runs after the member row has been updated. */
function releaseDeparting(s: ModelState, householdId: string, memberId: string): void {
  const householdParts = s.parts.filter((p) => p.householdId === householdId);
  const held = heldParts(memberId, householdParts, s.requests);
  for (const h of held) {
    const part = s.parts.find((p) => p.partId === h.partId)!;
    for (const role of h.roles) {
      part[HOLDER_FIELD[role]] = null;
      s.audit.push({
        type: "part.released",
        actorType: "system",
        actorId: null,
        householdId,
        payload: { role, member_id: memberId, reason: REASON_DEPARTED },
      });
    }
    for (const requestId of h.pendingRequestIds) {
      const r = s.requests.find((x) => x.id === requestId)!;
      r.status = "declined";
      s.audit.push({
        type: `${r.kind}.declined`,
        actorType: "system",
        actorId: null,
        householdId,
        payload: { request_id: r.id, reason: REASON_DEPARTED },
      });
      const otherId = r.fromId === memberId ? r.toId : r.fromId;
      const other = s.members.find((m) => m.id === otherId);
      if (other && other.isActive) {
        s.reminders.push({ kind: `${r.kind}_declined`, memberId: otherId, householdId, partId: part.partId });
      }
    }
    const performer = h.roles.find((r) => r === "owner" || r === "driver" || r === "companion");
    if (performer && h.approvalWillReset) {
      part.approvalState = "pending" satisfies ApprovalState;
      s.audit.push({
        type: "approval.reset",
        actorType: "system",
        actorId: null,
        householdId,
        payload: { changed: performer },
      });
      notifyPrimaries(s, householdId, "", "approval_reset", part.partId);
    }
    if (h.ownerless) {
      s.feed.push({
        kind: "part_released",
        householdId,
        partId: part.partId,
        params: { role: "owner", needs_someone: "true", reason: REASON_DEPARTED },
      });
      notifyPrimaries(s, householdId, memberId, "part_needs_someone", part.partId);
    }
  }
}

const trimmed = (v: string) => v.trim();

/** Applies one operation at `now`. Never mutates the input state. */
export function applyModel(input: ModelState, op: ModelOp, now: Date): ModelResult {
  const s = structuredClone(input);
  const result = run(s, op, now);
  return result.refused ? { ...result, state: input } : result;
}

function run(s: ModelState, op: ModelOp, now: Date): ModelResult {
  switch (op.kind) {
    case "create_household": {
      if (s.members.some((m) => m.userId === op.userId && m.isActive)) return refuse(s, "already_in_household");
      if (!isValidDisplayName(op.householdName) || !isValidDisplayName(op.displayName)) {
        return refuse(s, "invalid_input");
      }
      s.households.push({ id: op.householdId, name: trimmed(op.householdName) });
      s.members.push({
        id: op.memberId,
        userId: op.userId,
        householdId: op.householdId,
        role: "primary_caregiver",
        isActive: true,
        displayName: trimmed(op.displayName),
      });
      auditMembership(s, "household.created", op.householdId, op.userId, { householdId: op.householdId });
      auditMembership(s, "member.joined", op.householdId, op.userId, { memberId: op.memberId, role: "primary_caregiver" });
      return done(s, "created", { household_id: op.householdId, member_id: op.memberId });
    }

    case "create_invite": {
      const g = guardMembershipAction(op.actorUserId, s.members, { kind: "create_invite", householdId: op.householdId });
      if (!g.ok) return refuse(s, g.refusal);
      expireOverdue(s, op.householdId, now);
      const pending = s.invites.filter((i) => i.householdId === op.householdId && i.state === "pending").length;
      if (pending >= PENDING_INVITE_CAP) return refuse(s, "invite_cap_reached");
      const actor = s.members.find((m) => m.userId === op.actorUserId && m.householdId === op.householdId && m.isActive)!;
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
      s.invites.push({
        id: op.inviteId,
        householdId: op.householdId,
        role: op.role,
        token: op.token,
        createdByMemberId: actor.id,
        createdAt: now,
        expiresAt,
        state: "pending",
        acceptedByUserId: null,
        acceptedMemberId: null,
        acceptedAt: null,
        revokedByMemberId: null,
        revokedAt: null,
        expiredAt: null,
      });
      auditMembership(s, "invite.created", op.householdId, op.actorUserId, { inviteId: op.inviteId, role: op.role });
      return done(s, "created", { invite_id: op.inviteId, expires_at: expiresAt.toISOString() });
    }

    case "list_invites": {
      const g = guardMembershipAction(op.actorUserId, s.members, { kind: "create_invite", householdId: op.householdId });
      if (!g.ok) return refuse(s, g.refusal);
      expireOverdue(s, op.householdId, now);
      const rows = s.invites
        .map((i, index) => ({ i, index }))
        .filter(({ i }) => i.householdId === op.householdId)
        .sort((a, b) => b.i.createdAt.getTime() - a.i.createdAt.getTime() || b.index - a.index)
        .map(({ i }) => ({
          id: i.id,
          role: i.role,
          creator_member_id: i.createdByMemberId,
          created_at: i.createdAt.toISOString(),
          expires_at: i.expiresAt.toISOString(),
          state: i.state,
        }));
      return done(s, "listed", { invites: rows });
    }

    case "revoke_invite": {
      const g = guardMembershipAction(op.actorUserId, s.members, { kind: "revoke_invite", householdId: op.householdId });
      if (!g.ok) return refuse(s, g.refusal);
      expireOverdue(s, op.householdId, now);
      const inv = s.invites.find((i) => i.id === op.inviteId && i.householdId === op.householdId);
      if (!inv) return refuse(s, "not_found");
      if (inv.state !== "pending") return done(s, "not_pending", { state: inv.state });
      const actor = s.members.find((m) => m.userId === op.actorUserId && m.householdId === op.householdId && m.isActive)!;
      inv.state = "revoked";
      inv.revokedAt = now;
      inv.revokedByMemberId = actor.id;
      auditMembership(s, "invite.revoked", op.householdId, op.actorUserId, { inviteId: inv.id, role: inv.role });
      return done(s, "revoked");
    }

    case "preview_invite": {
      const inv = s.invites.find((i) => i.token === op.token);
      if (!inv) return done(s, "unusable");
      expireOverdue(s, inv.householdId, now);
      if (inv.state !== "pending") return done(s, "unusable");
      const household = s.households.find((h) => h.id === inv.householdId);
      const creator = s.members.find((m) => m.id === inv.createdByMemberId);
      return done(s, "usable", {
        household_name: household?.name ?? "",
        creator_display_name: creator?.displayName ?? "",
        role: inv.role,
        expires_at: inv.expiresAt.toISOString(),
      });
    }

    case "accept_invite": {
      const inv = s.invites.find((i) => i.token === op.token);
      if (!inv || inv.state !== "pending") return done(s, "unusable");
      if (now.getTime() >= inv.expiresAt.getTime()) {
        expireOne(s, inv, now);
        return done(s, "unusable");
      }
      const own = s.members.find((m) => m.userId === op.userId && m.householdId === inv.householdId);
      if (own?.isActive) return refuse(s, "already_member");
      if (s.members.some((m) => m.userId === op.userId && m.isActive)) return refuse(s, "one_household_only");
      if (!isValidDisplayName(op.displayName)) return refuse(s, "invalid_input");
      const name = trimmed(op.displayName);
      let member: ModelMember;
      if (own) {
        own.isActive = true;
        own.role = inv.role;
        own.displayName = name;
        member = own;
        auditMembership(s, "member.rejoined", inv.householdId, op.userId, { memberId: own.id, role: inv.role });
      } else {
        member = {
          id: op.memberId,
          userId: op.userId,
          householdId: inv.householdId,
          role: inv.role,
          isActive: true,
          displayName: name,
        };
        s.members.push(member);
        auditMembership(s, "member.joined", inv.householdId, op.userId, { memberId: member.id, role: inv.role });
      }
      inv.state = "accepted";
      inv.acceptedAt = now;
      inv.acceptedByUserId = op.userId;
      inv.acceptedMemberId = member.id;
      auditMembership(s, "invite.accepted", inv.householdId, op.userId, {
        inviteId: inv.id,
        memberId: member.id,
        role: inv.role,
      });
      s.feed.push({
        kind: "member_joined",
        householdId: inv.householdId,
        partId: null,
        params: { member_id: member.id, role: inv.role },
      });
      notifyPrimaries(s, inv.householdId, member.id, "member_joined", null);
      return done(s, "joined", { role: inv.role, member_id: member.id });
    }

    case "change_role": {
      const action: MembershipAction = {
        kind: "change_role",
        householdId: op.householdId,
        targetMemberId: op.memberId,
        newRole: op.role,
      };
      const g = guardMembershipAction(op.actorUserId, s.members, action);
      if (!g.ok) return refuse(s, g.refusal);
      const target = s.members.find((m) => m.id === op.memberId)!;
      if (target.role === op.role) return done(s, "unchanged");
      const oldRole = target.role;
      target.role = op.role;
      auditMembership(s, "member.role_changed", op.householdId, op.actorUserId, {
        memberId: target.id,
        oldRole,
        newRole: op.role,
      });
      s.feed.push({
        kind: "member_role_changed",
        householdId: op.householdId,
        partId: null,
        params: { member_id: target.id, role: op.role },
      });
      s.reminders.push({ kind: "member_role_changed", memberId: target.id, householdId: op.householdId, partId: null });
      if (op.role === "care_recipient") releaseDeparting(s, op.householdId, target.id);
      return done(s, "role_changed", { role: op.role });
    }

    case "deactivate": {
      const g = guardMembershipAction(op.actorUserId, s.members, {
        kind: "deactivate",
        householdId: op.householdId,
        targetMemberId: op.memberId,
      });
      if (!g.ok) return refuse(s, g.refusal);
      const target = s.members.find((m) => m.id === op.memberId)!;
      target.isActive = false;
      auditMembership(s, "member.deactivated", op.householdId, op.actorUserId, { memberId: target.id, role: target.role });
      releaseDeparting(s, op.householdId, target.id);
      return done(s, "deactivated");
    }

    case "leave": {
      const g = guardMembershipAction(op.actorUserId, s.members, { kind: "leave", householdId: op.householdId });
      if (!g.ok) return refuse(s, g.refusal);
      const actor = s.members.find((m) => m.userId === op.actorUserId && m.householdId === op.householdId && m.isActive)!;
      actor.isActive = false;
      auditMembership(s, "member.left", op.householdId, op.actorUserId, { memberId: actor.id, role: actor.role });
      releaseDeparting(s, op.householdId, actor.id);
      return done(s, "left");
    }

    case "rename": {
      const actor = s.members.find((m) => m.userId === op.actorUserId && m.householdId === op.householdId && m.isActive);
      const g = guardMembershipAction(op.actorUserId, s.members, {
        kind: "rename",
        householdId: op.householdId,
        targetMemberId: actor?.id ?? "",
      });
      if (!g.ok || !actor) return refuse(s, g.ok ? "not_found" : g.refusal);
      if (!isValidDisplayName(op.displayName)) return refuse(s, "invalid_input");
      actor.displayName = trimmed(op.displayName);
      auditMembership(s, "member.display_name_changed", op.householdId, op.actorUserId, { memberId: actor.id });
      return done(s, "renamed");
    }
  }
}

export { effectiveInviteState };
