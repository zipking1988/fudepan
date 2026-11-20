import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { roleSchema, type Role } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";

export const HOUSEHOLD_COOKIE = "fudepan_household";

export interface Membership {
  memberId: string;
  householdId: string;
  householdName: string;
  role: Role;
  displayName: string;
}

export type AuthContext =
  | { status: "unconfigured" }
  | { status: "signed_out" }
  | {
      status: "signed_in";
      supabase: SupabaseClient;
      userId: string;
      email: string | null;
      memberships: Membership[];
    };

/** Resolves the signed-in user and every household they belong to, using the RLS-bound client. */
export const getAuthContext = cache(async function getAuthContext(): Promise<AuthContext> {
  let supabase: SupabaseClient;
  try {
    supabase = await createClient();
  } catch {
    return { status: "unconfigured" };
  }

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { status: "signed_out" };

  const { data: rows } = await supabase
    .from("members")
    .select("id, household_id, role, display_name, created_at, households(name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  const memberships: Membership[] = [];
  for (const row of rows ?? []) {
    const role = roleSchema.safeParse(row.role);
    if (!role.success) continue;
    const household = row.households as { name?: string } | { name?: string }[] | null;
    const name = Array.isArray(household) ? household[0]?.name : household?.name;
    memberships.push({
      memberId: row.id as string,
      householdId: row.household_id as string,
      householdName: name ?? "Household",
      role: role.data,
      displayName: row.display_name as string,
    });
  }
  return { status: "signed_in", supabase, userId: user.id, email: user.email ?? null, memberships };
});

export type SessionContext =
  | { status: "unconfigured" }
  | { status: "signed_out" }
  | { status: "no_household" }
  | {
      status: "ready";
      supabase: SupabaseClient;
      userId: string;
      householdId: string;
      householdName: string;
      memberId: string;
      role: Role;
      displayName: string;
      memberships: Membership[];
    };

/**
 * The active household is the one in the selection cookie if the user belongs to it, otherwise
 * their first household. The cookie is only a hint: membership is checked on every request.
 */
export async function getSessionContext(): Promise<SessionContext> {
  const auth = await getAuthContext();
  if (auth.status !== "signed_in") return { status: auth.status };
  if (auth.memberships.length === 0) return { status: "no_household" };

  const selected = (await cookies()).get(HOUSEHOLD_COOKIE)?.value;
  const active = auth.memberships.find((m) => m.householdId === selected) ?? auth.memberships[0]!;

  return {
    status: "ready",
    supabase: auth.supabase,
    userId: auth.userId,
    householdId: active.householdId,
    householdName: active.householdName,
    memberId: active.memberId,
    role: active.role,
    displayName: active.displayName,
    memberships: auth.memberships,
  };
}
