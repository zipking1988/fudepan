"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getFamilyContext } from "@/lib/family/session";
import type { MessageKey } from "@/lib/i18n/messages";
import type { HeldPart } from "@/lib/membership/held-parts";
import { savePortrait } from "@/lib/portraits/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { listHeldParts } from "@/lib/membership/queries";
import { membershipRefusalKey } from "@/lib/membership/refusals";
import { changeRoleInput, memberTargetInput, renameInput, validateForm } from "@/lib/membership/schemas";
import {
  changeMemberRole,
  deactivateMember,
  leaveHousehold,
  setMemberDisplayName,
} from "@/lib/membership/service";

/**
 * Server Actions for the Members_Page. The signed-in person comes from the session, never from the
 * form. Results carry message keys; raw error text and codes never reach the client.
 */
export type MemberActionResult =
  | { ok: true; outcome: string; version?: string }
  | { ok: false; messageKey: MessageKey; fieldKeys?: Record<string, MessageKey> };

export type HeldPartsResult = { ok: true; parts: HeldPart[] } | { ok: false; messageKey: MessageKey };

const NOT_FOUND = { ok: false, messageKey: "membership.refusal.not_found" } as const;
const GENERIC = { ok: false, messageKey: "membership.error.generic" } as const;

function text(input: unknown, key: string): string {
  const value = (input as Record<string, unknown> | null)?.[key];
  return typeof value === "string" ? value : "";
}

/** The signed-in person and their own client, when they are an active member of the household. */
async function actor(householdId: string) {
  const { user } = await getSession();
  if (!user) return null;
  const family = await getFamilyContext(householdId);
  if (family.result?.kind !== "ok" || family.result.context.householdId !== householdId) return null;
  return { user, supabase: family.supabase, context: family.result.context };
}

function refresh() {
  revalidatePath("/family/members");
  revalidatePath("/family");
}

/** Open tasks that a removal or leaving would release, for the confirmation step. */
export async function loadHeldPartsAction(input: unknown): Promise<HeldPartsResult> {
  const parsed = validateForm(memberTargetInput, {
    householdId: text(input, "householdId"),
    memberId: text(input, "memberId"),
  });
  if (!parsed.ok) return { ok: false, messageKey: "membership.refusal.invalid_input" };
  const who = await actor(parsed.data.householdId);
  if (!who) return NOT_FOUND;
  try {
    return { ok: true, parts: await listHeldParts(who.supabase, parsed.data.householdId, parsed.data.memberId) };
  } catch {
    return GENERIC;
  }
}

export async function changeRoleAction(input: unknown): Promise<MemberActionResult> {
  const parsed = validateForm(changeRoleInput, {
    householdId: text(input, "householdId"),
    memberId: text(input, "memberId"),
    role: text(input, "role"),
  });
  if (!parsed.ok) return { ok: false, messageKey: "membership.refusal.invalid_input", fieldKeys: parsed.fieldKeys };
  const who = await actor(parsed.data.householdId);
  if (!who) return NOT_FOUND;
  const result = await changeMemberRole({ ...parsed.data, userId: who.user.id });
  if (!result.ok) return { ok: false, messageKey: membershipRefusalKey(result.code) };
  refresh();
  return { ok: true, outcome: result.data.outcome };
}

export async function removeMemberAction(input: unknown): Promise<MemberActionResult> {
  const parsed = validateForm(memberTargetInput, {
    householdId: text(input, "householdId"),
    memberId: text(input, "memberId"),
  });
  if (!parsed.ok) return { ok: false, messageKey: "membership.refusal.invalid_input" };
  const who = await actor(parsed.data.householdId);
  if (!who) return NOT_FOUND;
  const result = await deactivateMember({ ...parsed.data, userId: who.user.id });
  if (!result.ok) return { ok: false, messageKey: membershipRefusalKey(result.code) };
  refresh();
  return { ok: true, outcome: result.data.outcome };
}

/** On success this redirects to /welcome?left=1 and does not return. */
export async function leaveAction(input: unknown): Promise<MemberActionResult> {
  const parsed = validateForm(memberTargetInput.pick({ householdId: true }), { householdId: text(input, "householdId") });
  if (!parsed.ok) return { ok: false, messageKey: "membership.refusal.invalid_input" };
  const who = await actor(parsed.data.householdId);
  if (!who) return NOT_FOUND;
  const result = await leaveHousehold({ householdId: parsed.data.householdId, userId: who.user.id });
  if (!result.ok) return { ok: false, messageKey: membershipRefusalKey(result.code) };
  revalidatePath("/family", "layout");
  redirect("/welcome?left=1");
}

export async function renameAction(input: unknown): Promise<MemberActionResult> {
  const parsed = validateForm(renameInput, {
    householdId: text(input, "householdId"),
    displayName: text(input, "displayName"),
  });
  if (!parsed.ok) {
    return { ok: false, messageKey: "members.editName.error", fieldKeys: parsed.fieldKeys };
  }
  const who = await actor(parsed.data.householdId);
  if (!who) return NOT_FOUND;
  const result = await setMemberDisplayName({ ...parsed.data, userId: who.user.id });
  if (!result.ok) return { ok: false, messageKey: membershipRefusalKey(result.code) };
  refresh();
  return { ok: true, outcome: result.data.outcome };
}

const PORTRAIT_ERRORS: Record<string, MessageKey> = {
  not_allowed: "pb.portrait.err.notAllowed",
  no_file: "pb.portrait.err.noFile",
  empty: "pb.portrait.err.empty",
  too_large: "pb.portrait.err.tooLarge",
  unsupported_type: "pb.portrait.err.type",
};
/** Adds or changes the portrait of a care recipient. Only an active primary caregiver of the same household. */
export async function setPortraitAction(formData: FormData): Promise<MemberActionResult> {
  const memberId = formData.get("memberId");
  const file = formData.get("photo");
  const { supabase, user } = await getSession();
  if (!user || typeof memberId !== "string") return { ok: false, messageKey: "pb.portrait.err.notAllowed" };
  let saved: { updatedAt: string };
  const bytes = file instanceof File && file.size > 0 ? new Uint8Array(await file.arrayBuffer()) : null;
  try {
    const result = await savePortrait({ userClient: supabase, admin: createAdminClient(), userId: user.id, memberId, bytes });
    if (!result.ok) return { ok: false, messageKey: PORTRAIT_ERRORS[result.code] ?? "pb.portrait.err.failed" };
    saved = result;
  } catch {
    return { ok: false, messageKey: "pb.portrait.err.failed" };
  }
  refresh();
  return { ok: true, outcome: "portrait_saved", version: saved.updatedAt };
}
