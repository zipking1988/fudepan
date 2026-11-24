import "server-only";
import { headers } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { chooseHousehold } from "@/lib/households/membership";
import type { Language } from "@/lib/i18n/format";
import { resolveLanguage } from "@/lib/i18n/language";
import { hasInviteCookie } from "@/lib/membership/invite-cookie";
import { listMemberships } from "@/lib/households/queries";
import { resolveFamilyContext, type FamilyContext, type FamilyContextResult } from "./session-core";

export type { FamilyContext } from "./session-core";

/**
 * Resolves the signed-in person, household, member id, role, and language.
 * Returns null when signed out. Call it behind a <Suspense> boundary.
 */
export async function getFamilyContext(requestedHouseholdId?: string | null) {
  const { supabase, user } = await getSession();
  if (!user) return { supabase, user: null, result: null };
  const memberships = await listMemberships(supabase, user.id);
  const choice = chooseHousehold(memberships, requestedHouseholdId);
  if (choice.kind !== "ok") return { supabase, user, result: { kind: choice.kind } as FamilyContextResult };
  const householdId = choice.current.householdId;
  const acceptLanguage = (await headers()).get("accept-language");
  const { data, error } = await supabase
    .from("household_members")
    .select("id, role, ui_language")
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw new Error("member_query_failed");
  const result: FamilyContextResult = resolveFamilyContext(user.id, memberships, requestedHouseholdId, () => data, acceptLanguage);
  return { supabase, user, result };
}

/**
 * Language for screens shown before a Member is known (no household, not a member, signed out).
 * Uses Accept-Language only. Call it behind a <Suspense> boundary.
 */
export async function getRequestLanguage(): Promise<Language> {
  return resolveLanguage(null, (await headers()).get("accept-language"));
}

/** For pages: redirects to sign-in when signed out; returns the outcome otherwise. */
export async function requireFamilyContext(
  path: string,
  requestedHouseholdId?: string | null,
): Promise<
  | { kind: "ok"; context: FamilyContext; supabase: Awaited<ReturnType<typeof getSession>>["supabase"] }
  | { kind: "no_household" | "not_member"; language: Language }
> {
  const { supabase, user, result } = await getFamilyContext(requestedHouseholdId);
  if (!user || !result) redirect(`/login?next=${encodeURIComponent(path)}`);
  // No household yet: an invite link in progress goes to /join, everyone else to /welcome.
  if (result.kind === "no_household") redirect((await hasInviteCookie()) ? "/join" : "/welcome");
  if (result.kind !== "ok") return { kind: result.kind, language: await getRequestLanguage() };
  // Membership is verified: sweep this household after the response is sent (throttled, never throws).
  const householdId = result.context.householdId;
  after(async () => {
    const { runHouseholdSweep } = await import("./sweep");
    await runHouseholdSweep(householdId);
  });
  return { kind: "ok", context: result.context, supabase };
}
