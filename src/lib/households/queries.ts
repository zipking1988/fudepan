import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { isHouseholdRole, type Membership } from "./membership";

/**
 * The person's active memberships, oldest first. Uses their own
 * row-level-security client, so only their households can appear.
 */
export async function listMemberships(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("household_members")
    .select("household_id, role, display_name, created_at, households ( name )")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  if (error) throw new Error("membership_query_failed");

  return data.flatMap((row) =>
    isHouseholdRole(row.role) && row.households
      ? [
          {
            householdId: row.household_id,
            householdName: row.households.name,
            role: row.role,
            displayName: row.display_name,
          },
        ]
      : [],
  );
}

/** user_id → display name for everyone (current or former) in one household. */
export async function memberNames(
  supabase: SupabaseClient<Database>,
  householdId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("household_members")
    .select("user_id, display_name")
    .eq("household_id", householdId);
  if (error) throw new Error("member_query_failed");
  return new Map(data.map((m) => [m.user_id, m.display_name]));
}
