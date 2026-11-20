import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";

/**
 * Test fixtures for the local Supabase stack only. Fake emails on the reserved .test domain and
 * generic names ("Test Elder"). Never point this at a real project.
 */
export function admin(): SupabaseClient {
  const url = process.env.E2E_SUPABASE_URL;
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Local Supabase is not running. Run `supabase start` first.");
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url))
    throw new Error("E2E seeding only runs against local Supabase.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

export interface TestUser {
  id: string;
  email: string;
}

let counter = 0;

export async function createUser(label: string): Promise<TestUser> {
  counter += 1;
  const email = `e2e-${run}-${counter}-${label}@example.test`;
  const { data, error } = await admin().auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email };
}

/** Signs in through the app's real /auth/callback route with a one-time magic-link token. */
export async function signIn(page: Page, user: TestUser, next = "/") {
  const { data, error } = await admin().auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  if (error || !data.properties?.hashed_token)
    throw new Error(`generateLink failed: ${error?.message}`);
  await page.context().clearCookies();
  await page.goto(
    `/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`,
  );
}

export interface SeededHousehold {
  householdId: string;
  coordinator: TestUser;
  caregiver: TestUser;
  elder: TestUser;
  members: { coordinator: string; caregiver: string; elder: string };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin().rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

/** A household with a coordinator, a caregiver and an elder, joined through real invitations. */
export async function seedHousehold(): Promise<SeededHousehold> {
  const [coordinator, caregiver, elder] = await Promise.all([
    createUser("coord"),
    createUser("care"),
    createUser("elder"),
  ]);
  const householdId = await rpc<string>("create_household", {
    p_user_id: coordinator.id,
    p_name: "Test Household",
    p_display_name: "Test Coordinator",
  });
  for (const [user, role, name] of [
    [caregiver, "caregiver", "Test Caregiver"],
    [elder, "elder", "Test Elder"],
  ] as const) {
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    await rpc("create_invitation", {
      p_actor: coordinator.id,
      p_household_id: householdId,
      p_role: role,
      p_email: null,
      p_token_hash: hash,
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await rpc("accept_invitation", {
      p_user_id: user.id,
      p_email: user.email,
      p_token_hash: hash,
      p_display_name: name,
    });
  }
  const { data: rows } = await admin()
    .from("members")
    .select("id, role")
    .eq("household_id", householdId);
  const byRole = Object.fromEntries((rows ?? []).map((r) => [r.role as string, r.id as string]));
  return {
    householdId,
    coordinator,
    caregiver,
    elder,
    members: {
      coordinator: byRole.coordinator!,
      caregiver: byRole.caregiver!,
      elder: byRole.elder!,
    },
  };
}

/** A text note written by the elder, inserted with the service role as fixture data. */
export async function seedTextNote(h: SeededHousehold, text: string): Promise<string> {
  const { data, error } = await admin()
    .from("notes")
    .insert({
      household_id: h.householdId,
      created_by: h.elder.id,
      source_type: "text",
      text_content: text,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`note insert failed: ${error?.message}`);
  return data.id as string;
}

/** A high-risk task submitted for approval, created through the same database functions the app uses. */
export async function seedAwaitingTask(
  h: SeededHousehold,
  title = "Pick up test medicine",
  dueAt: string | null = null,
): Promise<string> {
  const noteId = await seedTextNote(h, `${title} on Friday`);
  const taskId = await rpc<string>("create_draft_task", {
    p_actor: h.coordinator.id,
    p_household_id: h.householdId,
    p_note_id: noteId,
    p_title: title,
    p_category: "medication",
    p_risk_level: "high",
    p_due_at: dueAt,
    p_location: null,
    p_assignee_id: null,
    p_notes: null,
    p_needs_review: false,
    p_audit_payload: { source: "e2e_fixture" },
  });
  await rpc("apply_task_action", {
    p_actor: h.coordinator.id,
    p_task_id: taskId,
    p_action: "submit",
    p_changes: {},
    p_payload: {},
  });
  return taskId;
}

export async function taskStatus(
  taskId: string,
): Promise<{ status: string; approved_by: string | null }> {
  const { data } = await admin()
    .from("tasks")
    .select("status, approved_by")
    .eq("id", taskId)
    .single();
  return data as { status: string; approved_by: string | null };
}

/** A Supabase client signed in as `user` with the public anon key, exactly as a browser would be. */
export async function browserClientFor(user: TestUser): Promise<SupabaseClient> {
  const url = process.env.E2E_SUPABASE_URL!;
  const anon = process.env.E2E_SUPABASE_ANON_KEY;
  if (!anon) throw new Error("Missing anon key");
  const { data } = await admin().auth.admin.generateLink({ type: "magiclink", email: user.email });
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.verifyOtp({
    token_hash: data.properties!.hashed_token,
    type: "magiclink",
  });
  if (error) throw new Error(`verifyOtp failed: ${error.message}`);
  return client;
}
