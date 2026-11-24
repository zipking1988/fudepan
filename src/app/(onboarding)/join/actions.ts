"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import type { HouseholdRole } from "@/lib/households/membership";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  clearInviteCookie,
  readInviteCookie,
  setInviteCookie,
} from "@/lib/membership/invite-cookie";
import { acceptInviteInput, openInviteInput, validateForm } from "@/lib/membership/schemas";
import { acceptInvite as acceptInviteService, previewInvite } from "@/lib/membership/service";

export type OpenInviteResult =
  | { kind: "none" }
  | { kind: "unusable" }
  | { kind: "error" }
  | { kind: "usable"; householdName: string; creatorName: string; role: HouseholdRole; expiresAt: string };

/**
 * Looks at the link without joining. The token comes from the page fragment (first visit) or from
 * the cookie (after sign-in). Every failure looks the same: "unusable".
 */
export async function openInvite(input: { token: string | null }): Promise<OpenInviteResult> {
  const parsed = openInviteInput.safeParse(input);
  if (!parsed.success) {
    await clearInviteCookie();
    return { kind: "unusable" };
  }
  const token = parsed.data.token ?? (await readInviteCookie());
  if (!token) return { kind: "none" };

  const result = await previewInvite(token);
  if (!result.ok) return { kind: "error" };
  if (result.data.outcome !== "usable") {
    await clearInviteCookie();
    return { kind: "unusable" };
  }
  await setInviteCookie(token, new Date(result.data.expires_at));
  return {
    kind: "usable",
    householdName: result.data.household_name,
    creatorName: result.data.creator_display_name,
    role: result.data.role,
    expiresAt: result.data.expires_at,
  };
}

export type AcceptInviteState = {
  values: { displayName: string };
  fieldKeys: Record<string, MessageKey>;
  errorKey: MessageKey | null;
  unusable: boolean;
};

export async function acceptInvite(_previous: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  const raw = {
    displayName: typeof formData.get("displayName") === "string" ? String(formData.get("displayName")) : "",
  };
  const { user } = await getSession();
  if (!user) redirect("/login?next=%2Fjoin");

  const validated = validateForm(acceptInviteInput, raw);
  if (!validated.ok) return { values: raw, fieldKeys: { displayName: "join.error.displayName" }, errorKey: null, unusable: false };

  const token = await readInviteCookie();
  if (!token) return { values: raw, fieldKeys: {}, errorKey: null, unusable: true };

  const result = await acceptInviteService({ token, userId: user.id, displayName: validated.data.displayName });
  if (!result.ok && result.code === "server_error") {
    return { values: raw, fieldKeys: {}, errorKey: "membership.error.generic", unusable: false };
  }
  await clearInviteCookie();
  if (!result.ok || result.data.outcome !== "joined") {
    return { values: raw, fieldKeys: {}, errorKey: null, unusable: true };
  }
  redirect("/family");
}
