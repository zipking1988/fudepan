"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { getFamilyContext } from "@/lib/family/session";
import type { MessageKey } from "@/lib/i18n/messages";
import { membershipRefusalKey } from "@/lib/membership/refusals";
import { createInviteInput, revokeInviteInput, validateForm } from "@/lib/membership/schemas";
import { createInvite, revokeInvite } from "@/lib/membership/service";

/**
 * Server Actions for the Invite_Page. Results carry message keys, never raw error text.
 * The raw token is returned once by `createInviteAction` and is never logged.
 */
export type CreateInviteResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; messageKey: MessageKey };

export type RevokeInviteResult =
  | { ok: true; state: "revoked" }
  | { ok: true; state: "not_pending"; inviteState: string }
  | { ok: false; messageKey: MessageKey };

const SIGNED_OUT: { ok: false; messageKey: MessageKey } = { ok: false, messageKey: "membership.refusal.not_found" };
const INVALID: { ok: false; messageKey: MessageKey } = { ok: false, messageKey: "membership.refusal.invalid_input" };

export async function createInviteAction(input: unknown): Promise<CreateInviteResult> {
  const { user } = await getSession();
  if (!user) return SIGNED_OUT;
  const raw = input as { householdId?: unknown; role?: unknown } | null;
  const parsed = validateForm(createInviteInput, {
    householdId: typeof raw?.householdId === "string" ? raw.householdId : "",
    role: typeof raw?.role === "string" ? raw.role : "",
  });
  if (!parsed.ok) return { ok: false, messageKey: parsed.fieldKeys.role ?? INVALID.messageKey };
  const family = await getFamilyContext(parsed.data.householdId);
  if (family.result?.kind !== "ok" || family.result.context.householdId !== parsed.data.householdId) return SIGNED_OUT;
  const result = await createInvite({ householdId: parsed.data.householdId, userId: user.id, role: parsed.data.role });
  if (!result.ok) return { ok: false, messageKey: membershipRefusalKey(result.code) };
  revalidatePath("/family/invites");
  return { ok: true, token: result.data.token, expiresAt: result.data.expiresAt };
}

export async function revokeInviteAction(input: unknown): Promise<RevokeInviteResult> {
  const { user } = await getSession();
  if (!user) return SIGNED_OUT;
  const raw = input as { householdId?: unknown; inviteId?: unknown } | null;
  const parsed = validateForm(revokeInviteInput, {
    householdId: typeof raw?.householdId === "string" ? raw.householdId : "",
    inviteId: typeof raw?.inviteId === "string" ? raw.inviteId : "",
  });
  if (!parsed.ok) return INVALID;
  const family = await getFamilyContext(parsed.data.householdId);
  if (family.result?.kind !== "ok" || family.result.context.householdId !== parsed.data.householdId) return SIGNED_OUT;
  const result = await revokeInvite({ ...parsed.data, userId: user.id });
  if (!result.ok) return { ok: false, messageKey: membershipRefusalKey(result.code) };
  revalidatePath("/family/invites");
  return result.data.outcome === "revoked"
    ? { ok: true, state: "revoked" }
    : { ok: true, state: "not_pending", inviteState: result.data.state };
}
