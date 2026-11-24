import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Membership concurrency (family-app-demo-parity task 12.1, Requirements 6.4, 14.2, 14.3).
 *
 *   - Two parallel accept_invite calls on one invite: exactly one `joined`.
 *   - Two parallel demotions of the last two Primary_Caregivers: exactly one commits, the other
 *     raises `last_primary_caregiver`.
 *
 * Runs against the local stack only. Creates throwaway users and households with unique e-mail
 * addresses and deletes them in afterAll. The seeded demo household is never touched.
 */
type Client = SupabaseClient<Database>;
const url = process.env.INTEGRATION_SUPABASE_URL ?? "";
const serviceKey = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!url || !serviceKey) {
  throw new Error(
    "Set INTEGRATION_SUPABASE_URL and INTEGRATION_SUPABASE_SERVICE_ROLE_KEY (see vitest.integration.config.mts).",
  );
}
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("This test creates users and households; it only runs against a local stack.");
}
const admin: Client = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const run = crypto.randomUUID().slice(0, 8);
const createdUserIds: string[] = [];
const householdIds: string[] = [];

async function createUser(key: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `membership-${run}-${key}@example.com`,
    password: `pw-${crypto.randomUUID()}`,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

function newToken(): { hash: string } {
  const hash = createHash("sha256").update(randomBytes(32)).digest("hex");
  return { hash: `\\x${hash}` };
}

async function createHousehold(ownerId: string, name: string): Promise<{ householdId: string; memberId: string }> {
  const { data, error } = await admin.rpc("create_household", {
    p_user_id: ownerId,
    p_household_name: `${name} ${run}`,
    p_display_name: "Owner",
  });
  if (error) throw new Error(`create_household failed: ${error.message}`);
  const result = data as { household_id: string; member_id: string };
  householdIds.push(result.household_id);
  const { data: member, error: memberError } = await admin
    .from("household_members")
    .select("id")
    .eq("household_id", result.household_id)
    .eq("user_id", ownerId)
    .single();
  if (memberError) throw new Error(`member lookup failed: ${memberError.message}`);
  return { householdId: result.household_id, memberId: member.id };
}

async function invite(householdId: string, creatorId: string, role: string): Promise<string> {
  const { hash } = newToken();
  const { error } = await admin.rpc("create_invite", {
    p_household_id: householdId,
    p_user_id: creatorId,
    p_role: role,
    p_token_hash: hash,
  });
  if (error) throw new Error(`create_invite failed: ${error.message}`);
  return hash;
}

async function deleteWhere(table: string, column: string, ids: string[]) {
  const { error } = await (admin.from(table as never) as unknown as {
    delete: () => { in: (c: string, v: string[]) => Promise<{ error: { message: string } | null }> };
  })
    .delete()
    .in(column, ids);
  if (error) throw new Error(`cleanup of ${table} failed: ${error.message}`);
}

afterAll(async () => {
  if (householdIds.length > 0) {
    for (const table of ["feed_items", "member_feed_state", "step_escalations", "household_invites", "audit_events"]) {
      await deleteWhere(table, "household_id", householdIds);
    }
    await deleteWhere("household_members", "household_id", householdIds);
    await deleteWhere("households", "id", householdIds);
  }
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe("Membership concurrency", () => {
  let ownerA: string;
  let ownerB: string;

  beforeAll(async () => {
    ownerA = await createUser("owner-a");
    ownerB = await createUser("owner-b");
  });

  it("6.4 two parallel accept_invite calls on one invite give exactly one 'joined'", async () => {
    const { householdId } = await createHousehold(ownerA, "Accept race");
    const hash = await invite(householdId, ownerA, "family_member");
    const [c, d] = await Promise.all([createUser("joiner-c"), createUser("joiner-d")]);
    const results = await Promise.all(
      [c, d].map((userId) =>
        admin.rpc("accept_invite", { p_token_hash: hash, p_user_id: userId, p_display_name: "Joiner" }),
      ),
    );
    for (const r of results) expect(r.error).toBeNull();
    const outcomes = results.map((r) => (r.data as { outcome: string }).outcome).sort();
    expect(outcomes).toEqual(["joined", "unusable"]);
    const { data: members } = await admin
      .from("household_members")
      .select("user_id")
      .eq("household_id", householdId)
      .eq("is_active", true);
    expect(members).toHaveLength(2);
  });

  it("14.2 14.3 two parallel demotions of the last two primary caregivers commit exactly one", async () => {
    const { householdId } = await createHousehold(ownerB, "Demotion race");
    const second = await createUser("second-primary");
    const hash = await invite(householdId, ownerB, "primary_caregiver");
    const accepted = await admin.rpc("accept_invite", {
      p_token_hash: hash,
      p_user_id: second,
      p_display_name: "Second",
    });
    expect(accepted.error).toBeNull();
    const { data: rows } = await admin
      .from("household_members")
      .select("id, user_id")
      .eq("household_id", householdId)
      .eq("is_active", true);
    expect(rows).toHaveLength(2);
    // Each primary caregiver demotes themselves at the same moment.
    const results = await Promise.all(
      rows!.map((m) =>
        admin.rpc("change_member_role", {
          p_household_id: householdId,
          p_member_id: m.id,
          p_user_id: m.user_id,
          p_role: "family_member",
        }),
      ),
    );
    const ok = results.filter((r) => !r.error);
    const refused = results.filter((r) => r.error);
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].error?.message).toContain("last_primary_caregiver");
    const { data: after } = await admin
      .from("household_members")
      .select("role")
      .eq("household_id", householdId)
      .eq("is_active", true);
    expect(after!.filter((m) => m.role === "primary_caregiver")).toHaveLength(1);
  });
});
