import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Keeps the old synchronous reading flow (triggerExtraction) from calling ai&
 * a second time for a note that the new automatic recognition already handles.
 *
 *  - latest run queued or running  -> "being_read" (recognition is on it)
 *  - latest run succeeded with a chain -> "done" (return that chain)
 *  - no run, or a failed run       -> "proceed" (the old flow may read the note)
 *
 * Call this only after the person's access to the note has been checked; the
 * lookup uses the service role.
 */

export type RunSnapshot = { status: string; care_chain_id: string | null } | null;

export type LegacyGuardDecision =
  | { kind: "proceed" }
  | { kind: "being_read" }
  | { kind: "done"; careChainId: string };

export function decideLegacyGuard(run: RunSnapshot): LegacyGuardDecision {
  if (!run) return { kind: "proceed" };
  if (run.status === "queued" || run.status === "running") return { kind: "being_read" };
  if ((run.status === "succeeded" || run.status === "superseded") && run.care_chain_id) {
    return { kind: "done", careChainId: run.care_chain_id };
  }
  return { kind: "proceed" };
}

export async function checkLegacyGuard(
  admin: SupabaseClient<Database>,
  noteId: string,
): Promise<LegacyGuardDecision> {
  const { data, error } = await admin
    .from("recognition_runs")
    .select("status, care_chain_id")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false })
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  // If the lookup fails, do not read: a second ai& call is worse than a retry.
  if (error) return { kind: "being_read" };
  return decideLegacyGuard(data);
}
