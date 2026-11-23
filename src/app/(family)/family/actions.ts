"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { APPOINTMENT_LOCATION_MAX, zonedTimeToInstant } from "@/lib/care/appointment";
import {
  createSupabaseAppointmentClarificationStore,
  type SaveRefusal,
} from "@/lib/care/appointment-clarification";
import { createEvidenceUploadService } from "@/lib/care/evidence-upload";
import { createSupabaseEvidenceUploadStore } from "@/lib/care/evidence-upload-store";
import {
  createPartActionService,
  createSupabasePartActionStore,
  type PartActionResult,
} from "@/lib/care/part-actions";
import { getFamilyContext } from "@/lib/family/session";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

import { retryRecognition as retryNoteRecognition } from "@/app/(app)/notes/actions";

/**
 * Server Actions for the /family screens.
 *
 * Each action requires the session, hands the raw input to the Part action
 * service (which validates it with Zod and runs the SQL function that holds
 * the rules), revalidates the pages that show the Part, and returns a plain
 * result. Results carry message KEYS and params, never raw SQL, refusal codes,
 * or English text. The page translates them with the Member's language.
 * Nothing here writes a table directly.
 */

export type FamilyActionResult =
  | {
      ok: true;
      outcome?: string;
      messageKey?: string;
      evidenceId?: string;
      /** Labels of required evidence still missing (outcome "evidence_required"). */
      missing?: string[];
    }
  | { ok: false; messageKey: string; params: { field?: string } };

/** Message keys for committed outcomes the person must still be told about. */
const OUTCOME_MESSAGE_KEYS: Record<string, string> = {
  expired: "outcome.requestExpired",
  evidence_required: "outcome.evidenceRequired",
};

function services() {
  const admin = createAdminClient();
  const partActions = createPartActionService({
    store: createSupabasePartActionStore(admin, log),
    log,
  });
  return { admin, partActions };
}

function revalidateEvent(noteId: string): void {
  revalidatePath("/family");
  revalidatePath(`/family/events/${noteId}`);
  revalidatePath(`/family/events/${noteId}/timeline`);
}

function toActionResult(result: PartActionResult | { ok: false; messageKey: string; params: { field?: string } }): FamilyActionResult {
  if (!result.ok) return { ok: false, messageKey: result.messageKey, params: result.params };
  const out = result as Extract<PartActionResult, { ok: true }>;
  revalidateEvent(out.noteId);
  const messageKey = OUTCOME_MESSAGE_KEYS[out.outcome];
  return {
    ok: true,
    outcome: out.outcome,
    ...(messageKey !== undefined && { messageKey }),
    ...(out.evidenceId !== undefined && { evidenceId: out.evidenceId }),
    ...(out.missing !== undefined && { missing: out.missing }),
  };
}

type PartActions = ReturnType<typeof services>["partActions"];
type OutcomeMethod =
  | "claim"
  | "release"
  | "requestAssignment"
  | "requestHandover"
  | "requestBackup"
  | "volunteerBackup"
  | "respond"
  | "decideApproval"
  | "resubmit"
  | "complete"
  | "fail"
  | "reopen"
  | "saveAmount"
  | "resolveMissingDetail";

async function call(method: OutcomeMethod, input: unknown): Promise<FamilyActionResult> {
  const session = await getSession();
  const { partActions } = services();
  const run = partActions[method] as PartActions["claim"];
  return toActionResult(await run(session.user, input));
}

export async function claimPart(input: unknown) {
  return call("claim", input);
}
export async function releasePart(input: unknown) {
  return call("release", input);
}
export async function requestAssignment(input: unknown) {
  return call("requestAssignment", input);
}
export async function requestHandover(input: unknown) {
  return call("requestHandover", input);
}
export async function requestBackup(input: unknown) {
  return call("requestBackup", input);
}
export async function volunteerBackup(input: unknown) {
  return call("volunteerBackup", input);
}
export async function respondToRequest(input: unknown) {
  return call("respond", input);
}
export async function decideApproval(input: unknown) {
  return call("decideApproval", input);
}
export async function resubmitPart(input: unknown) {
  return call("resubmit", input);
}
export async function completePart(input: unknown) {
  return call("complete", input);
}
export async function reportPartFailed(input: unknown) {
  return call("fail", input);
}
export async function reopenPart(input: unknown) {
  return call("reopen", input);
}
export async function savePartAmount(input: unknown) {
  return call("saveAmount", input);
}
export async function resolveMissingDetail(input: unknown) {
  return call("resolveMissingDetail", input);
}

const confirmTimeInput = z.object({
  stepId: z.uuid(),
  kind: z.enum(["respond_by", "task_due"]),
  localDate: z.string().max(10),
  localTime: z.string().max(5),
  timeZone: z.string().min(1).max(64),
});

/** Converts the person's local date, time, and zone to one instant, then confirms it. */
export async function confirmPartTime(input: unknown): Promise<FamilyActionResult> {
  const session = await getSession();
  if (!session.user) return { ok: false, messageKey: "refusal.signedOut", params: {} };

  const parsed = confirmTimeInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      messageKey: "refusal.invalidInput",
      params: typeof field === "string" ? { field } : {},
    };
  }
  const { stepId, kind, localDate, localTime, timeZone } = parsed.data;
  const instant = zonedTimeToInstant(localDate, localTime, timeZone);
  if (!instant.ok) {
    const field =
      instant.reason === "invalid_date"
        ? "localDate"
        : instant.reason === "invalid_zone"
          ? "timeZone"
          : "localTime";
    return { ok: false, messageKey: "refusal.invalidInput", params: { field } };
  }

  const { partActions } = services();
  return toActionResult(
    await partActions.confirmTime(session.user, {
      stepId,
      kind,
      at: instant.instant.toISOString(),
      timeZone,
    }),
  );
}

const appointmentDetailsInput = z.object({
  stepId: z.uuid(),
  location: z.string().trim().min(1).max(APPOINTMENT_LOCATION_MAX),
  localDate: z.string().max(10),
  localTime: z.string().max(5),
  timeZone: z.string().min(1).max(64),
});

const APPOINTMENT_REFUSAL_KEYS: Record<SaveRefusal, string> = {
  // Same key for both, so nobody learns whether another household's step exists.
  step_not_found: "refusal.notFoundOrNoAccess",
  not_allowed: "refusal.notFoundOrNoAccess",
  not_appointment: "refusal.invalidInput",
  invalid_input: "refusal.invalidInput",
  error: "refusal.error",
};

/**
 * Saves hospital or clinic, date, and time on an appointment step. The local date and time and the
 * person's time zone become one instant here; the SQL function checks membership and writes the audit event.
 */
export async function saveAppointmentDetails(input: unknown): Promise<FamilyActionResult> {
  const session = await getSession();
  if (!session.user) return { ok: false, messageKey: "refusal.signedOut", params: {} };

  const parsed = appointmentDetailsInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      messageKey: "refusal.invalidInput",
      params: typeof field === "string" ? { field } : {},
    };
  }
  const { stepId, location, localDate, localTime, timeZone } = parsed.data;
  const instant = zonedTimeToInstant(localDate, localTime, timeZone);
  if (!instant.ok) {
    const field =
      instant.reason === "invalid_date"
        ? "localDate"
        : instant.reason === "invalid_zone"
          ? "timeZone"
          : "localTime";
    return { ok: false, messageKey: "refusal.invalidInput", params: { field } };
  }

  const saved = await createSupabaseAppointmentClarificationStore(createAdminClient(), log).save({
    stepId,
    userId: session.user.id,
    location,
    appointmentAt: instant.instant.toISOString(),
    timeZone,
  });
  if (!saved.ok) return { ok: false, messageKey: APPOINTMENT_REFUSAL_KEYS[saved.code], params: {} };

  if (saved.noteId) revalidateEvent(saved.noteId);
  else revalidatePath("/family");
  return { ok: true };
}

export async function markFeedSeen(input: unknown): Promise<FamilyActionResult> {
  const session = await getSession();
  const { partActions } = services();
  const result = await partActions.markFeedSeen(session.user, input);
  if (!result.ok) return { ok: false, messageKey: result.messageKey, params: result.params };
  revalidatePath("/family");
  return { ok: true };
}

const setLanguageInput = z.object({
  householdId: z.uuid().optional(),
  language: z.enum(["en", "ja"]),
});

/**
 * Saves the signed-in Member's language. The household comes from the person's own membership
 * (a requested id is only used to choose among their households), never from the client alone.
 */
export async function setLanguage(input: unknown): Promise<FamilyActionResult> {
  const { user } = await getSession();
  if (!user) return { ok: false, messageKey: "refusal.signedOut", params: {} };

  const parsed = setLanguageInput.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      ok: false,
      messageKey: "refusal.invalidInput",
      params: typeof field === "string" ? { field } : {},
    };
  }

  const family = await getFamilyContext(parsed.data.householdId);
  if (family.result?.kind !== "ok") {
    return { ok: false, messageKey: "refusal.notFoundOrNoAccess", params: {} };
  }
  const { partActions } = services();
  const result = await partActions.setLanguage(user, {
    householdId: family.result.context.householdId,
    language: parsed.data.language,
  });
  if (!result.ok) return { ok: false, messageKey: result.messageKey, params: result.params };
  revalidatePath("/family");
  revalidatePath("/family/settings/language");
  return { ok: true };
}

/**
 * The Care_Recipient's fixed reply about a note: "Thank you" or "I have a question"
 * (Requirement 13.8 to 13.11). The SQL function checks the role and household at
 * processing time, records one audit event, and reminds every active primary caregiver.
 */
export async function sendRecipientReply(input: unknown): Promise<FamilyActionResult> {
  const { user } = await getSession();
  if (!user) return { ok: false, messageKey: "refusal.signedOut", params: {} };
  const { partActions } = services();
  const result = await partActions.sendReply(user, input);
  if (!result.ok) return { ok: false, messageKey: result.messageKey, params: result.params };
  const noteId = (input as { noteId: string }).noteId;
  revalidateEvent(noteId);
  revalidatePath(`/family/me/${noteId}`);
  return {
    ok: true,
    outcome: result.outcome,
    messageKey: result.outcome === "already_sent" ? "recipient.reply.alreadySent" : "recipient.reply.sent",
  };
}

/** The family-flavoured wrapper over the note screen's retry. Recognition runs in `after()` there. */
export async function retryRecognition(input: unknown): Promise<FamilyActionResult> {
  const { user } = await getSession();
  if (!user) return { ok: false, messageKey: "refusal.signedOut", params: {} };

  const noteId = z.uuid().safeParse(input);
  if (!noteId.success) {
    return { ok: false, messageKey: "refusal.invalidInput", params: { field: "noteId" } };
  }
  const result = await retryNoteRecognition(noteId.data);
  if (!result.ok) return { ok: false, messageKey: "refusal.notFoundOrNoAccess", params: {} };
  revalidateEvent(noteId.data);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

async function evidenceService() {
  const session = await getSession();
  const { admin, partActions } = services();
  const service = createEvidenceUploadService({
    store: createSupabaseEvidenceUploadStore({ userClient: session.supabase, admin }),
    partActions,
    log,
  });
  return { service, partActions, user: session.user };
}

export async function prepareEvidenceUpload(input: unknown) {
  const { service, user } = await evidenceService();
  return service.prepare(user, input);
}

export async function completeEvidenceUpload(input: unknown): Promise<FamilyActionResult> {
  const { service, user } = await evidenceService();
  return toActionResult(await service.complete(user, input));
}

/** Text evidence is stored only in `part_evidence`, never in the audit trail (Requirement 15.3). */
export async function addTextEvidence(input: unknown): Promise<FamilyActionResult> {
  const { partActions, user } = await evidenceService();
  const value = (input ?? {}) as { stepId?: unknown; label?: unknown; text?: unknown };
  return toActionResult(
    await partActions.recordEvidence(user, {
      stepId: value.stepId,
      kind: "text",
      label: value.label,
      text: value.text,
    }),
  );
}
