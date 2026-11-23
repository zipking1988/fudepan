"use server";

import { revalidatePath } from "next/cache";

import { getSession } from "@/lib/auth/session";
import {
  createAppointmentClarificationService,
  createSupabaseAppointmentClarificationStore,
} from "@/lib/care/appointment-clarification";
import { createLegacyCareActions } from "@/lib/care/legacy-actions";
import { createPartActionService, createSupabasePartActionStore } from "@/lib/care/part-actions";
import { extractionFailureMessage } from "@/lib/care/extraction-messages";
import { checkLegacyGuard } from "@/lib/care/recognition-guard";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Built per call so the service-role client is never created at import time. */
function legacyActions() {
  return createLegacyCareActions({
    getSession,
    service: createPartActionService({
      store: createSupabasePartActionStore(createAdminClient(), log),
      log,
    }),
    revalidateChain: (careChainId) => {
      revalidatePath(`/care/${careChainId}`);
      revalidatePath(`/care/${careChainId}/timeline`);
    },
    log,
  });
}

/**
 * The four actions below keep their old names and shapes, but run through the
 * same guarded service as the new flow (Requirements 9.13, 11.8, 15.3, 18.5,
 * 21.1 to 21.6). None of them writes care_steps or audit_events directly.
 * A successful result may carry a plain `message` for the page to show.
 */
type LegacyActionResult = ActionResult<{ message?: string }>;

/** Ask for, claim, hand over, or release responsibility. Changes of person need that person's answer. */
export async function assignStepOwner(input: unknown): Promise<LegacyActionResult> {
  return legacyActions().assignStepOwner(input);
}

/** Approve a high-risk care step (only an active primary caregiver). */
export async function approveStep(input: unknown): Promise<LegacyActionResult> {
  return legacyActions().approveStep(input);
}

/** Mark a care step as done (only the Owner). Missing evidence is a plain message, not an error. */
export async function completeStep(input: unknown): Promise<LegacyActionResult> {
  return legacyActions().completeStep(input);
}

/** Add text evidence to a step. The text is stored as evidence, never in the audit trail. */
export async function addTextEvidence(input: unknown): Promise<LegacyActionResult> {
  return legacyActions().addTextEvidence(input);
}

/** Where reading a note stands, for the old upload page to poll. */
export type ReadingStatus =
  | { state: "reading" }
  | { state: "ready"; careChainId: string }
  | { state: "failed"; message: string };

/**
 * Latest recognition run for a note the person can see. Read-only; never calls ai&.
 * A note with no run yet counts as "reading" (the run is created with the upload).
 */
export async function getReadingStatus(noteId: string): Promise<ReadingStatus> {
  const { supabase, user } = await getSession();
  const failed = (reason: string): ReadingStatus => ({
    state: "failed",
    message: extractionFailureMessage(reason),
  });
  if (!user) return failed("signed_out");
  const { data: visibleNote } = await supabase.from("notes").select("id").eq("id", noteId).maybeSingle();
  if (!visibleNote) return failed("note_not_found");

  const { data: run, error } = await createAdminClient()
    .from("recognition_runs")
    .select("status, care_chain_id, failure_reason")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false })
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !run) return { state: "reading" };
  if ((run.status === "succeeded" || run.status === "superseded") && run.care_chain_id) {
    return { state: "ready", careChainId: run.care_chain_id };
  }
  if (run.status === "queued" || run.status === "running") return { state: "reading" };
  return failed(run.failure_reason ?? "unknown");
}

/**
 * Trigger ai& extraction for a note. While automatic recognition is already
 * reading the note this is not a failure: the result is `{ ok: false, state:
 * "reading" }` so callers can show progress instead of an error.
 */
export async function triggerExtraction(
  noteId: string,
): Promise<ActionResult<{ careChainId: string }> | { ok: false; error: string; state: "reading" }> {
  const { user } = await getSession();
  if (!user) return { ok: false, error: "You must be signed in." };

  // The person must be able to see the note (row-level security) before anything is revealed.
  const { supabase } = await getSession();
  const { data: visibleNote } = await supabase.from("notes").select("id").eq("id", noteId).maybeSingle();
  if (!visibleNote) return { ok: false, error: extractionFailureMessage("note_not_found") };

  // Automatic recognition owns notes that have an active or finished run: never call ai& twice.
  const guard = await checkLegacyGuard(createAdminClient(), noteId);
  if (guard.kind === "being_read") {
    revalidatePath(`/notes/${noteId}`);
    return { ok: false, error: extractionFailureMessage("being_read"), state: "reading" };
  }
  if (guard.kind === "done") {
    revalidatePath(`/notes/${noteId}`);
    return { ok: true, careChainId: guard.careChainId };
  }

  // Import dynamically to avoid bundling ai client into every server action
  const { runExtraction } = await import("@/lib/care/extraction");
  const result = await runExtraction(noteId);

  if (!result.ok) {
    revalidatePath(`/notes/${noteId}`);
    return { ok: false, error: extractionFailureMessage(result.reason) };
  }

  revalidatePath(`/notes/${noteId}`);
  revalidatePath(`/care/${result.careChainId}`);
  return { ok: true, careChainId: result.careChainId };
}

/**
 * Run escalation detection for the current user's households.
 * Called from the care chain page or a cron job.
 * Returns count of newly escalated steps.
 */
export async function runEscalationCheck(
  householdId: string,
): Promise<ActionResult<{ count: number }>> {
  const { user } = await getSession();
  if (!user) return { ok: false, error: "You must be signed in." };

  // Verify membership via RLS client before using admin
  const { supabase } = await getSession();
  const { data: membership } = await supabase
    .from("household_members")
    .select("id")
    .eq("household_id", householdId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!membership) return { ok: false, error: "You are not a member of this household." };

  // A person pressed "check now": run the sweep without the per-minute throttle.
  const { runHouseholdSweep } = await import("@/lib/family/sweep");
  const sweep = await runHouseholdSweep(householdId, { force: true });
  if (sweep.failedSteps.includes("escalation")) {
    return { ok: false, error: "The check could not be completed. Nothing was changed. Please try again." };
  }

  const count = sweep.escalation?.escalated ?? 0;
  if (count > 0) {
    revalidatePath(`/care`);
    revalidatePath(`/family`);
  }

  return { ok: true, count };
}

/**
 * Save the hospital or clinic and the appointment date/time a person adds to
 * an appointment step. The input is the shape built by
 * buildAppointmentClarificationInput (an ISO instant with an offset plus the
 * IANA time zone). The step fields and the `appointment_clarified` audit event
 * are written together by public.save_appointment_clarification, which also
 * re-checks active household membership. Status, approval, due_at,
 * escalation_at, and the note quote are never changed here.
 */
export async function saveAppointmentClarification(input: unknown): Promise<ActionResult> {
  const { user } = await getSession();
  if (!user) return { ok: false, error: "You must be signed in." };

  const service = createAppointmentClarificationService({
    store: createSupabaseAppointmentClarificationStore(createAdminClient(), log),
    log,
  });
  const result = await service.save(user, input);
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(`/care/${result.careChainId}`);
  revalidatePath(`/care/${result.careChainId}/timeline`);
  return { ok: true };
}
