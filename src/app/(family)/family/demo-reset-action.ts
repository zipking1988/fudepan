"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth/session";
import { DEMO_HOUSEHOLD_ID } from "@/lib/family/playful";
import { getDemoAccount } from "@/app/login/demo-account";

/** The one demo note we keep in a known good state for judges. */
const DEMO_NOTE_ID = "d5f11637-1a3d-4032-aac6-b94c54f55588";

/** Initial task assignments matching what we set up for the hackathon demo. */
const RESET_STEPS: Record<string, {
  owner_id: string | null;
  backup_owner_id: string | null;
  driver_id: string | null;
  companion_id: string | null;
  approval_state: string;
  status: string;
}> = {
  // Prepare insurance card — Misa
  "03656900-fe03-49d9-945c-06ff6d45efe7": {
    owner_id: "d2000000-0000-4000-8000-000000000002",
    backup_owner_id: null,
    driver_id: null,
    companion_id: null,
    approval_state: "pending",
    status: "in_progress",
  },
  // Pick up glasses — Yui, backup Kenta
  "1327b433-3001-4b83-b276-06100aed7f10": {
    owner_id: "d2000000-0000-4000-8000-000000000004",
    backup_owner_id: "d2000000-0000-4000-8000-000000000003",
    driver_id: null,
    companion_id: null,
    approval_state: "not_required",
    status: "in_progress",
  },
  // Attend hospital appointment — Kenta owns + drives, Misa goes along
  "ecfdecb3-cb54-47fc-b0ac-dcad6b144939": {
    owner_id: "d2000000-0000-4000-8000-000000000003",
    backup_owner_id: null,
    driver_id: "d2000000-0000-4000-8000-000000000003",
    companion_id: "d2000000-0000-4000-8000-000000000002",
    approval_state: "pending",
    status: "pending_review",
  },
};

/**
 * Server Action: reset the demo note's care steps to the known good state.
 * Only available when DEMO_EMAIL / DEMO_PASSWORD are configured (i.e. demo mode is on).
 * The caller must be signed in to the demo household — we re-check server-side.
 */
export async function resetDemoNote(): Promise<{ ok: boolean; error?: string }> {
  // Only runs in demo mode
  if (!getDemoAccount()) return { ok: false, error: "not_demo" };

  const { user } = await getSession();
  if (!user) return { ok: false, error: "signed_out" };

  const admin = createAdminClient();

  // Verify caller belongs to the demo household
  const { data: member } = await admin
    .from("household_members")
    .select("id")
    .eq("household_id", DEMO_HOUSEHOLD_ID)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!member) return { ok: false, error: "not_member" };

  // Reset each step
  for (const [stepId, values] of Object.entries(RESET_STEPS)) {
    const { error } = await admin
      .from("care_steps")
      .update(values)
      .eq("id", stepId);
    if (error) return { ok: false, error: "update_failed" };
  }

  // Delete any evidence uploaded during the demo session
  await admin.from("part_evidence").delete().in("care_step_id", Object.keys(RESET_STEPS));

  // Delete pending care requests on this note's chain
  const { data: chains } = await admin
    .from("care_chains")
    .select("id")
    .eq("note_id", DEMO_NOTE_ID);
  if (chains && chains.length > 0) {
    const chainIds = chains.map((c) => c.id);
    await admin.from("care_requests").delete().in("care_chain_id", chainIds);
  }

  // Record the reset in the audit trail
  await admin.from("audit_events").insert({
    household_id: DEMO_HOUSEHOLD_ID,
    actor_type: "member",
    event_type: "demo.reset",
    payload: { note_id: DEMO_NOTE_ID, reset_by: member.id },
  });

  revalidatePath("/family");
  return { ok: true };
}
