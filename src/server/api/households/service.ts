import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildInviteUrl,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
} from "@/lib/invitations";
import type { Role } from "@/lib/permissions";

export type HouseholdErrorCode =
  | "invalid_name"
  | "too_many_households"
  | "forbidden"
  | "invalid_invitation"
  | "already_member"
  | "last_coordinator"
  | "invalid_role"
  | "member_not_found"
  | "database_failed";

export class HouseholdServiceError extends Error {
  constructor(public readonly code: HouseholdErrorCode) {
    super(code);
    this.name = "HouseholdServiceError";
  }
}

const KNOWN: HouseholdErrorCode[] = [
  "invalid_name",
  "too_many_households",
  "forbidden",
  "invalid_invitation",
  "already_member",
  "last_coordinator",
  "invalid_role",
  "member_not_found",
];

function mapError(error: { message?: string; code?: string }): HouseholdServiceError {
  const known = KNOWN.find((k) => k === error.message);
  if (known) return new HouseholdServiceError(known);
  if (error.code === "42501") return new HouseholdServiceError("forbidden");
  return new HouseholdServiceError("database_failed");
}

/** Messages shown to people. No database details. */
export const HOUSEHOLD_ERROR_MESSAGES: Record<HouseholdErrorCode, string> = {
  invalid_name: "Please enter a name.",
  too_many_households: "You have reached the household limit.",
  forbidden: "You do not have permission to do that.",
  invalid_invitation:
    "This invitation link is not valid. It may have expired or been used already.",
  already_member: "You are already a member of this household.",
  last_coordinator: "A household needs at least one coordinator.",
  invalid_role: "Please choose a valid role.",
  member_not_found: "We could not find that member.",
  database_failed: "Something went wrong. Please try again.",
};

export async function createHousehold(args: {
  admin: SupabaseClient;
  userId: string;
  name: string;
  displayName: string;
}): Promise<string> {
  const { data, error } = await args.admin.rpc("create_household", {
    p_user_id: args.userId,
    p_name: args.name,
    p_display_name: args.displayName,
  });
  if (error) throw mapError(error);
  return data as string;
}

export async function createInvitation(args: {
  admin: SupabaseClient;
  actorId: string;
  householdId: string;
  role: Role;
  email: string | null;
  origin: string;
  now?: Date;
}): Promise<{ invitationId: string; url: string; expiresAt: string }> {
  const token = generateInviteToken();
  const expiresAt = inviteExpiry(args.now).toISOString();
  const { data, error } = await args.admin.rpc("create_invitation", {
    p_actor: args.actorId,
    p_household_id: args.householdId,
    p_role: args.role,
    p_email: args.email,
    p_token_hash: hashInviteToken(token),
    p_expires_at: expiresAt,
  });
  if (error) throw mapError(error);
  // The raw token is returned once and never stored.
  return { invitationId: data as string, url: buildInviteUrl(args.origin, token), expiresAt };
}

export async function acceptInvitation(args: {
  admin: SupabaseClient;
  userId: string;
  email: string | null;
  token: string;
  displayName: string;
}): Promise<string> {
  const { data, error } = await args.admin.rpc("accept_invitation", {
    p_user_id: args.userId,
    p_email: args.email,
    p_token_hash: hashInviteToken(args.token),
    p_display_name: args.displayName,
  });
  if (error) throw mapError(error);
  return data as string;
}

export async function revokeInvitation(args: {
  admin: SupabaseClient;
  actorId: string;
  invitationId: string;
}): Promise<void> {
  const { error } = await args.admin.rpc("revoke_invitation", {
    p_actor: args.actorId,
    p_invitation_id: args.invitationId,
  });
  if (error) throw mapError(error);
}

export async function setMemberRole(args: {
  admin: SupabaseClient;
  actorId: string;
  memberId: string;
  role: Role;
}): Promise<void> {
  const { error } = await args.admin.rpc("set_member_role", {
    p_actor: args.actorId,
    p_member_id: args.memberId,
    p_role: args.role,
  });
  if (error) throw mapError(error);
}
