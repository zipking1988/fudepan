import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { PORTRAIT_BUCKET } from "./rules";
import { openPortrait, portraitVersions, savePortrait } from "./service";
/**
 * Member portraits against the local stack only: synthetic images, throwaway users and households.
 * Allowed: primary caregiver writes; any active member of the same household reads.
 * Denied: anonymous, another household, a non-primary role, a non-recipient target, bad bytes.
 */
type Client = SupabaseClient<Database>;
const url = process.env.INTEGRATION_SUPABASE_URL ?? "";
const serviceKey = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY ?? "";
const anonKey = process.env.INTEGRATION_SUPABASE_ANON_KEY ?? "";
if (!url || !serviceKey || !anonKey) throw new Error("Set the INTEGRATION_SUPABASE_* variables (see vitest.integration.config.mts).");
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Local stack only.");
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin: Client = createClient<Database>(url, serviceKey, opts);
const run = crypto.randomUUID().slice(0, 8);
const users: string[] = [];
const households: string[] = [];
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
async function user(key: string) {
  const email = `portrait-${run}-${key}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(error?.message);
  users.push(data.user.id);
  const client: Client = createClient<Database>(url, anonKey, opts);
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(signed.error.message);
  return { id: data.user.id, client };
}
async function household(owner: string) {
  const { data, error } = await admin.rpc("create_household", { p_user_id: owner, p_household_name: `Portrait ${run}`, p_display_name: "Owner" });
  if (error) throw new Error(error.message);
  const id = (data as { household_id: string }).household_id;
  households.push(id);
  return id;
}
async function addMember(householdId: string, userId: string, role: string) {
  const { data, error } = await admin.from("household_members").insert({ household_id: householdId, user_id: userId, role, display_name: role }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}
afterAll(async () => {
  for (const h of households) {
    const { data } = await admin.from("member_portraits").select("object_path").eq("household_id", h);
    if (data?.length) await admin.storage.from(PORTRAIT_BUCKET).remove(data.map((r) => r.object_path));
    await admin.from("member_portraits").delete().eq("household_id", h);
    for (const t of ["feed_items", "member_feed_state", "household_invites", "audit_events"] as const) await admin.from(t).delete().eq("household_id", h);
    await admin.from("household_members").delete().eq("household_id", h);
    await admin.from("households").delete().eq("id", h);
  }
  for (const id of users) await admin.auth.admin.deleteUser(id);
});
describe("member portraits", () => {
  let primary: Awaited<ReturnType<typeof user>>, family: typeof primary, recipient: typeof primary, outsider: typeof primary;
  let recipientMember: string, familyMember: string, primaryMember: string, otherHousehold: string, h: string;
  beforeAll(async () => {
    [primary, family, recipient, outsider] = await Promise.all([user("p"), user("f"), user("r"), user("o")]);
    h = await household(primary.id);
    otherHousehold = await household(outsider.id);
    recipientMember = await addMember(h, recipient.id, "care_recipient");
    familyMember = await addMember(h, family.id, "family_member");
    const { data } = await admin.from("household_members").select("id").eq("household_id", h).eq("user_id", primary.id).single();
    primaryMember = data!.id;
  });
  const save = (who: typeof primary, memberId: string, bytes: Uint8Array | null) =>
    savePortrait({ userClient: who.client, admin, userId: who.id, memberId, bytes });
  it("lets the primary caregiver add and change a portrait; same-household members read it", async () => {
    expect(await save(primary, recipientMember, png)).toMatchObject({ ok: true });
    for (const who of [primary, family, recipient]) {
      const file = await openPortrait({ userClient: who.client, admin, userId: who.id, memberId: recipientMember });
      expect(file?.contentType).toBe("image/png");
      expect(new Uint8Array(await file!.body.arrayBuffer())).toEqual(png);
    }
    expect((await portraitVersions(family.client, h)).has(recipientMember)).toBe(true);
    expect(await save(primary, recipientMember, jpg)).toMatchObject({ ok: true });
    const changed = await openPortrait({ userClient: family.client, admin, userId: family.id, memberId: recipientMember });
    expect(changed?.contentType).toBe("image/jpeg");
    const { data } = await admin.storage.from(PORTRAIT_BUCKET).list(`${h}/${recipientMember}`);
    expect(data).toHaveLength(1);
  });
  it("denies writes to other roles, other households, and non-recipient targets", async () => {
    expect(await save(family, recipientMember, png)).toEqual({ ok: false, code: "not_allowed" });
    expect(await save(outsider, recipientMember, png)).toEqual({ ok: false, code: "not_allowed" });
    expect(await save(primary, familyMember, png)).toEqual({ ok: false, code: "not_allowed" });
  });
  it("lets every active member set their own portrait, and nobody else's", async () => {
    expect(await save(primary, primaryMember, png)).toMatchObject({ ok: true });
    expect(await save(family, familyMember, png)).toMatchObject({ ok: true });
    expect(await save(family, primaryMember, png)).toEqual({ ok: false, code: "not_allowed" });
    const own = await openPortrait({ userClient: recipient.client, admin, userId: recipient.id, memberId: familyMember });
    expect(own?.contentType).toBe("image/png");
    expect(await openPortrait({ userClient: outsider.client, admin, userId: outsider.id, memberId: familyMember })).toBeNull();
  });
  it("rejects bad bytes without changing the portrait", async () => {
    expect(await save(primary, recipientMember, new Uint8Array([1, 2, 3]))).toEqual({ ok: false, code: "unsupported_type" });
    expect(await save(primary, recipientMember, new Uint8Array(2 * 1024 * 1024 + 1))).toEqual({ ok: false, code: "too_large" });
    expect(await save(primary, recipientMember, null)).toEqual({ ok: false, code: "no_file" });
    const still = await openPortrait({ userClient: primary.client, admin, userId: primary.id, memberId: recipientMember });
    expect(still?.contentType).toBe("image/jpeg");
  });
  it("keeps serving a demoted member's portrait in the household and stops when they are inactive", async () => {
    const { data: m } = await admin.from("household_members").insert({ household_id: h, user_id: (await user("x")).id, role: "care_recipient", display_name: "Temp" }).select("id").single();
    expect(await save(primary, m!.id, png)).toMatchObject({ ok: true });
    const read = () => openPortrait({ userClient: family.client, admin, userId: family.id, memberId: m!.id });
    expect(await read()).not.toBeNull();
    await admin.from("household_members").update({ role: "family_member" }).eq("id", m!.id);
    expect(await read()).not.toBeNull();
    await admin.from("household_members").update({ role: "care_recipient", is_active: false }).eq("id", m!.id);
    expect(await read()).toBeNull();
  });
  it("denies reads to another household and to anonymous callers, and exposes nothing through Storage", async () => {
    expect(await openPortrait({ userClient: outsider.client, admin, userId: outsider.id, memberId: recipientMember })).toBeNull();
    const anon: Client = createClient<Database>(url, anonKey, opts);
    expect(await openPortrait({ userClient: anon, admin, userId: crypto.randomUUID(), memberId: recipientMember })).toBeNull();
    expect((await anon.from("member_portraits").select("member_id")).data ?? []).toHaveLength(0);
    expect((await outsider.client.from("member_portraits").select("member_id")).data ?? []).toHaveLength(0);
    const { data: row } = await admin.from("member_portraits").select("object_path").eq("member_id", recipientMember).single();
    for (const who of [anon, outsider.client, family.client]) {
      const dl = await who.storage.from(PORTRAIT_BUCKET).download(row!.object_path);
      expect(dl.data).toBeNull();
      const up = await who.storage.from(PORTRAIT_BUCKET).upload(`${h}/${recipientMember}/1760000000001-portrait.png`, png);
      expect(up.error).not.toBeNull();
    }
    const direct = await anon.from("member_portraits").insert({ member_id: recipientMember, household_id: otherHousehold, object_path: "x", content_type: "image/png", size_bytes: 1, updated_by: primary.id });
    expect(direct.error).not.toBeNull();
    const pub = await fetch(`${url}/storage/v1/object/public/${PORTRAIT_BUCKET}/${row!.object_path}`);
    expect(pub.status).not.toBe(200);
  });
});
