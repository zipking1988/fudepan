import { HOUSEHOLD_ROLES } from "@/lib/households/membership";
import { INVITE_STATES } from "./invite-state";

export const MEMBERSHIP_EVENT_TYPES = [
  "household.created",
  "member.joined",
  "member.rejoined",
  "member.role_changed",
  "member.deactivated",
  "member.left",
  "member.display_name_changed",
  "invite.created",
  "invite.revoked",
  "invite.accepted",
  "invite.expired",
] as const;
export type MembershipEventType = (typeof MEMBERSHIP_EVENT_TYPES)[number];

export type AuditIds = {
  householdId?: string;
  memberId?: string;
  inviteId?: string;
  role?: string;
  oldRole?: string;
  newRole?: string;
  state?: string;
  reason?: string;
  /** Anything else a caller passes (names, emails, tokens) is ignored. */
  [extra: string]: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON = /^[a-z][a-z0-9_]{0,39}$/;
const isRole = (v: unknown): v is string => typeof v === "string" && (HOUSEHOLD_ROLES as readonly string[]).includes(v);
const isState = (v: unknown): v is string => typeof v === "string" && (INVITE_STATES as readonly string[]).includes(v);
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isReason = (v: unknown): v is string => typeof v === "string" && REASON.test(v);

/** Fields that each event may carry, as payload key -> input key and checker. */
const FIELDS: Record<MembershipEventType, readonly string[]> = {
  "household.created": ["household_id"],
  "member.joined": ["member_id", "role"],
  "member.rejoined": ["member_id", "role"],
  "member.role_changed": ["member_id", "old_role", "new_role"],
  "member.deactivated": ["member_id", "role"],
  "member.left": ["member_id", "role"],
  "member.display_name_changed": ["member_id"],
  "invite.created": ["invite_id", "role"],
  "invite.revoked": ["invite_id", "role"],
  "invite.accepted": ["invite_id", "member_id", "role"],
  "invite.expired": ["invite_id", "role"],
};

/**
 * Payload for a membership audit event: UUIDs, Role codes, Invite_State codes, and reason codes only.
 * A value that does not have the right shape is dropped, so names, emails, and tokens cannot get in.
 */
export function membershipAuditPayload(event: MembershipEventType, ids: AuditIds): Record<string, string> {
  const source: Record<string, [unknown, (v: unknown) => v is string]> = {
    household_id: [ids.householdId, isUuid],
    member_id: [ids.memberId, isUuid],
    invite_id: [ids.inviteId, isUuid],
    role: [ids.role, isRole],
    old_role: [ids.oldRole, isRole],
    new_role: [ids.newRole, isRole],
    state: [ids.state, isState],
    reason: [ids.reason, isReason],
  };
  const out: Record<string, string> = {};
  for (const key of [...FIELDS[event], "state", "reason"]) {
    const entry = source[key];
    if (!entry) continue;
    const [value, valid] = entry;
    if (value !== undefined && valid(value)) out[key] = value;
  }
  return out;
}
