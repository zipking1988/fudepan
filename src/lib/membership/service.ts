import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { HOUSEHOLD_ROLES, type HouseholdRole } from "@/lib/households/membership";
import { errorCode, log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { INVITE_STATES } from "./invite-state";
import { generateInviteToken, hashInviteToken } from "./invite-token";

/**
 * Server-only wrapper over the ten public membership functions (design K3, K4).
 * Callers must pass a `userId` that they verified from the session.
 *
 * Raw invite tokens are hashed here, in Node, before any call. A failure returns a short code and
 * never `error.message`, so nothing here can leak a token, a name, or an email into logs.
 */
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; code: string };

const REFUSAL_CODE = /^[a-z_]+$/;

/** `bytea` arguments travel as hex text: `\x` plus 64 hex characters. */
export function tokenHashArg(token: string): string {
  return `\\x${Buffer.from(hashInviteToken(token)).toString("hex")}`;
}

const role = z.enum(HOUSEHOLD_ROLES);
const state = z.enum(INVITE_STATES);
const uuid = z.uuid();
const isoDate = z.string().min(1);

const outcomes = {
  create_household: z.object({ outcome: z.literal("created"), household_id: uuid, member_id: uuid }),
  create_invite: z.object({ outcome: z.literal("created"), invite_id: uuid, expires_at: isoDate }),
  list_invites: z.object({
    outcome: z.literal("listed"),
    invites: z.array(
      z.object({
        id: uuid,
        role,
        creator_member_id: uuid,
        created_at: isoDate,
        expires_at: isoDate,
        state,
      }),
    ),
  }),
  revoke_invite: z.union([
    z.object({ outcome: z.literal("revoked") }),
    z.object({ outcome: z.literal("not_pending"), state }),
  ]),
  preview_invite: z.union([
    z.object({
      outcome: z.literal("usable"),
      household_name: z.string(),
      creator_display_name: z.string(),
      role,
      expires_at: isoDate,
    }),
    z.object({ outcome: z.literal("unusable") }),
  ]),
  accept_invite: z.union([
    z.object({ outcome: z.literal("joined"), role, member_id: uuid }),
    z.object({ outcome: z.literal("unusable") }),
  ]),
  change_member_role: z.union([
    z.object({ outcome: z.literal("role_changed"), role }),
    z.object({ outcome: z.literal("unchanged") }),
  ]),
  deactivate_member: z.object({ outcome: z.literal("deactivated") }),
  leave_household: z.object({ outcome: z.literal("left") }),
  set_member_display_name: z.object({ outcome: z.literal("renamed") }),
} as const;

type FunctionName = keyof typeof outcomes;
type Outcome<N extends FunctionName> = z.infer<(typeof outcomes)[N]>;

async function call<N extends FunctionName>(name: N, args: Record<string, string>): Promise<ServiceResult<Outcome<N>>> {
  try {
    // The generated rpc() overloads are per function; each caller below fixes its own argument shape.
    const admin = createAdminClient() as unknown as {
      rpc: (
        fn: string,
        args: Record<string, string>,
      ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
    };
    const { data, error } = await admin.rpc(name, args);
    if (error) {
      if (error.code === "P0001" && typeof error.message === "string" && REFUSAL_CODE.test(error.message)) {
        return { ok: false, code: error.message };
      }
      log("error", "membership.error", { code: errorCode(error), reason: name });
      return { ok: false, code: "server_error" };
    }
    const parsed = outcomes[name].safeParse(data);
    if (!parsed.success) {
      log("error", "membership.error", { code: "bad_outcome", reason: name });
      return { ok: false, code: "server_error" };
    }
    return { ok: true, data: parsed.data as Outcome<N> };
  } catch (error) {
    log("error", "membership.error", { code: errorCode(error), reason: name });
    return { ok: false, code: "server_error" };
  }
}

export function createHousehold(input: { userId: string; householdName: string; displayName: string }) {
  return call("create_household", {
    p_user_id: input.userId,
    p_household_name: input.householdName,
    p_display_name: input.displayName,
  });
}

/**
 * Generates a token, stores only its hash, and returns the raw token once for the caller to show.
 * The caller must not log it or store it.
 */
export async function createInvite(input: {
  householdId: string;
  userId: string;
  role: HouseholdRole;
}): Promise<ServiceResult<{ token: string; inviteId: string; expiresAt: string }>> {
  const token = generateInviteToken((n) => new Uint8Array(randomBytes(n)));
  const result = await call("create_invite", {
    p_household_id: input.householdId,
    p_user_id: input.userId,
    p_role: input.role,
    p_token_hash: tokenHashArg(token),
  });
  if (!result.ok) return result;
  return { ok: true, data: { token, inviteId: result.data.invite_id, expiresAt: result.data.expires_at } };
}

export type InviteListItem = Outcome<"list_invites">["invites"][number];

export async function listInvites(input: {
  householdId: string;
  userId: string;
}): Promise<ServiceResult<InviteListItem[]>> {
  const result = await call("list_invites", { p_household_id: input.householdId, p_user_id: input.userId });
  return result.ok ? { ok: true, data: result.data.invites } : result;
}

export function revokeInvite(input: { householdId: string; inviteId: string; userId: string }) {
  return call("revoke_invite", {
    p_household_id: input.householdId,
    p_invite_id: input.inviteId,
    p_user_id: input.userId,
  });
}

export function previewInvite(token: string) {
  return call("preview_invite", { p_token_hash: tokenHashArg(token) });
}

export function acceptInvite(input: { token: string; userId: string; displayName: string }) {
  return call("accept_invite", {
    p_token_hash: tokenHashArg(input.token),
    p_user_id: input.userId,
    p_display_name: input.displayName,
  });
}

export function changeMemberRole(input: { householdId: string; memberId: string; userId: string; role: HouseholdRole }) {
  return call("change_member_role", {
    p_household_id: input.householdId,
    p_member_id: input.memberId,
    p_user_id: input.userId,
    p_role: input.role,
  });
}

export function deactivateMember(input: { householdId: string; memberId: string; userId: string }) {
  return call("deactivate_member", {
    p_household_id: input.householdId,
    p_member_id: input.memberId,
    p_user_id: input.userId,
  });
}

export function leaveHousehold(input: { householdId: string; userId: string }) {
  return call("leave_household", { p_household_id: input.householdId, p_user_id: input.userId });
}

export function setMemberDisplayName(input: { householdId: string; userId: string; displayName: string }) {
  return call("set_member_display_name", {
    p_household_id: input.householdId,
    p_user_id: input.userId,
    p_display_name: input.displayName,
  });
}
