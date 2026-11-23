import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { extractCareChain, type ExtractionResult } from "@/lib/ai/client";
import { errorCode, log as defaultLog, type Logger } from "@/lib/log";
import { NOTES_BUCKET } from "@/lib/notes/rules";
import { isNoteObjectPathFor, parseNoteObjectPath } from "@/lib/notes/storage-path";
import { isUuid } from "@/lib/ids";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { mapDraftToRows, validateDraftRowsPayload, type DraftRowsPayload } from "./draft-rows";

/**
 * Recognition of one note: start a run, read the photo, ask ai&, save the
 * draft in one transaction, or fail the run with a plain reason code.
 *
 * Rules:
 *  - `recognize` never throws. Every failure ends in `fail_recognition_run`
 *    with a code from FAILURE_CODES, never model output, prompt, or note text.
 *  - ai& is called only after `start_recognition_run` returned `started`, so a
 *    running or finished run never causes a second call (Requirements 2.12, 2.13).
 *  - Logs carry stage, code, and IDs only.
 *  - Scheduling with `after()` is done by the server action, not here.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Plain reason codes stored on a failed run. Fixed list. */
export const FAILURE_CODES = [
  "image_not_found",
  "model_unavailable",
  "upload_failed",
  "completion_failed",
  "invalid_json",
  "schema_invalid",
  "safety_violation",
  "payload_invalid",
  "db_error",
  "lease_expired",
  "unexpected_error",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];

const RETRYABLE: Record<FailureCode, boolean> = {
  image_not_found: false,
  model_unavailable: false,
  upload_failed: true,
  completion_failed: true,
  invalid_json: true,
  schema_invalid: true,
  safety_violation: true,
  payload_invalid: true,
  db_error: true,
  lease_expired: true,
  unexpected_error: true,
};

export type StartOutcome = "started" | "already_running" | "done" | "failed";

export type StartedRun = {
  outcome: StartOutcome;
  runId: string | null;
  attempt: number | null;
  noteId: string;
  householdId: string;
  careChainId: string | null;
};

export type StaleRunRow = {
  runId: string;
  noteId: string;
  householdId: string;
  attempt: number;
  action: "restart" | "failed";
};

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: string };

export interface RecognitionStore {
  start(noteId: string, userId: string | null): Promise<StoreResult<StartedRun>>;
  save(runId: string, payload: DraftRowsPayload): Promise<StoreResult<{ careChainId: string | null }>>;
  fail(runId: string, code: FailureCode, retryable: boolean): Promise<StoreResult<null>>;
  resumeStale(limit: number, householdId?: string): Promise<StoreResult<StaleRunRow[]>>;
}

export type NoteImageBytes = { bytes: Uint8Array; contentType: string };

export type RecognitionDeps = {
  store: RecognitionStore;
  /** Service-role read of the private photo. Null when it cannot be read. */
  readNoteImage: (input: { noteId: string; householdId: string }) => Promise<NoteImageBytes | null>;
  extract: (bytes: Uint8Array, contentType: string) => Promise<ExtractionResult>;
  log: Logger;
  now: () => Date;
};

export type RecognitionState =
  | { state: "ready"; runId: string; careChainId: string | null }
  | { state: "already_running"; runId: string | null }
  | { state: "done"; careChainId: string | null }
  | { state: "failed"; runId: string | null; code: string; retryable: boolean }
  | { state: "not_started"; code: string };

export type ResumeSummary = { restarted: number; failed: number; errors: number };

const MAX_RESUME_CONCURRENCY = 2;

/**
 * Lease of a started run. Longer than the 300 s `maxDuration` of the routes
 * that host recognition, so a sweeper never restarts a run that is still
 * alive. If the function dies, the lease expires and the sweeper resumes it.
 */
export const RECOGNITION_LEASE_SECONDS = 330;

// ---------------------------------------------------------------------------
// Recognizer
// ---------------------------------------------------------------------------

export function createRecognizer(deps: RecognitionDeps) {
  const { store, readNoteImage, extract, log } = deps;

  async function failRun(
    run: StartedRun,
    code: FailureCode,
  ): Promise<Extract<RecognitionState, { state: "failed" }>> {
    const retryable = RETRYABLE[code];
    const runId = run.runId;
    if (runId) {
      try {
        const result = await store.fail(runId, code, retryable);
        if (!result.ok) {
          log("error", "recognition.fail_not_recorded", {
            stage: "fail",
            code: result.code,
            note_id: run.noteId,
          });
        }
      } catch {
        log("error", "recognition.fail_not_recorded", {
          stage: "fail",
          code: "threw",
          note_id: run.noteId,
        });
      }
    }
    log("warn", "recognition.failed", { stage: "fail", code, note_id: run.noteId });
    return { state: "failed", runId, code, retryable };
  }

  async function work(run: StartedRun): Promise<RecognitionState> {
    const runId = run.runId;
    if (!runId) return failRun(run, "unexpected_error");

    // Read the photo.
    let image: NoteImageBytes | null = null;
    try {
      image = await readNoteImage({ noteId: run.noteId, householdId: run.householdId });
    } catch (error) {
      log("error", "recognition.image_read_threw", {
        stage: "read_image",
        code: errorCode(error),
        note_id: run.noteId,
      });
    }
    if (!image) return failRun(run, "image_not_found");

    // Ask ai&.
    let result: ExtractionResult;
    try {
      result = await extract(image.bytes, image.contentType);
    } catch (error) {
      log("error", "recognition.extract_threw", {
        stage: "extract",
        code: errorCode(error),
        note_id: run.noteId,
      });
      return failRun(run, "completion_failed");
    }
    if (!result.ok) {
      const code = (FAILURE_CODES as readonly string[]).includes(result.reason)
        ? (result.reason as FailureCode)
        : "unexpected_error";
      return failRun(run, code);
    }

    // Map and validate the rows that the SQL function will accept.
    let payload: DraftRowsPayload;
    try {
      const mapped = mapDraftToRows(result.draft);
      const checked = validateDraftRowsPayload(mapped.payload);
      if (!checked.ok) {
        log("warn", "recognition.payload_invalid", {
          stage: "validate",
          code: "payload_invalid",
          count: checked.issues.length,
          note_id: run.noteId,
        });
        return failRun(run, "payload_invalid");
      }
      payload = checked.payload;
    } catch (error) {
      log("error", "recognition.map_threw", {
        stage: "validate",
        code: errorCode(error),
        note_id: run.noteId,
      });
      return failRun(run, "payload_invalid");
    }

    // One transactional save.
    let saved: StoreResult<{ careChainId: string | null }>;
    try {
      saved = await store.save(runId, payload);
    } catch (error) {
      log("error", "recognition.save_threw", {
        stage: "save",
        code: errorCode(error),
        note_id: run.noteId,
      });
      return failRun(run, "db_error");
    }
    if (!saved.ok) {
      log("error", "recognition.save_failed", {
        stage: "save",
        code: saved.code,
        note_id: run.noteId,
      });
      return failRun(run, "db_error");
    }
    log("info", "recognition.saved", { stage: "save", status: "ready", note_id: run.noteId });
    return { state: "ready", runId, careChainId: saved.value.careChainId };
  }

  async function recognize(noteId: string, userId: string | null): Promise<RecognitionState> {
    try {
      let started: StoreResult<StartedRun>;
      try {
        started = await store.start(noteId, userId);
      } catch (error) {
        log("error", "recognition.start_threw", {
          stage: "start",
          code: errorCode(error),
          note_id: noteId,
        });
        return { state: "not_started", code: "error" };
      }
      if (!started.ok) {
        log("warn", "recognition.start_refused", { stage: "start", code: started.code, note_id: noteId });
        return { state: "not_started", code: started.code };
      }
      const run = started.value;
      log("info", "recognition.start", {
        stage: "start",
        status: run.outcome,
        note_id: noteId,
        household_id: run.householdId,
      });
      switch (run.outcome) {
        case "already_running":
          return { state: "already_running", runId: run.runId };
        case "done":
          return { state: "done", careChainId: run.careChainId };
        case "failed":
          return { state: "failed", runId: run.runId, code: "lease_expired", retryable: true };
        case "started":
          return await work(run);
        default:
          return { state: "not_started", code: "error" };
      }
    } catch (error) {
      // Last resort: the caller never sees an exception.
      log("error", "recognition.unexpected", {
        stage: "recognize",
        code: errorCode(error),
        note_id: noteId,
      });
      return { state: "not_started", code: "error" };
    }
  }

  /** Restarts stale runs the SQL sweeper support listed. Bounded concurrency. */
  async function resumeStaleRuns(limit = 20, householdId?: string): Promise<ResumeSummary> {
    const summary: ResumeSummary = { restarted: 0, failed: 0, errors: 0 };
    try {
      const listed = await (householdId ? store.resumeStale(limit, householdId) : store.resumeStale(limit));
      if (!listed.ok) {
        log("error", "recognition.resume_failed", { stage: "resume", code: listed.code });
        summary.errors += 1;
        return summary;
      }
      const restart = listed.value.filter((r) => r.action === "restart");
      summary.failed = listed.value.length - restart.length;
      const queue = [...restart];
      const worker = async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          const outcome = await recognize(row.noteId, null);
          if (outcome.state === "not_started") summary.errors += 1;
          else summary.restarted += 1;
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_RESUME_CONCURRENCY, queue.length) }, worker));
      log("info", "recognition.resumed", { stage: "resume", count: summary.restarted });
    } catch (error) {
      log("error", "recognition.resume_threw", { stage: "resume", code: errorCode(error) });
      summary.errors += 1;
    }
    return summary;
  }

  return { recognize, resumeStaleRuns };
}

export type Recognizer = ReturnType<typeof createRecognizer>;

// ---------------------------------------------------------------------------
// Supabase store (service role)
// ---------------------------------------------------------------------------

const startRow = z.object({
  outcome: z.enum(["started", "already_running", "done", "failed"]),
  run_id: z.string().nullable(),
  attempt: z.number().int().nullable(),
  note_id: z.string(),
  household_id: z.string(),
  care_chain_id: z.string().nullable(),
});
const saveRow = z.object({
  outcome: z.enum(["created", "existing"]),
  care_chain_id: z.string().nullable(),
});
const staleRow = z.object({
  run_id: z.string(),
  note_id: z.string(),
  household_id: z.string(),
  attempt: z.number().int(),
  action: z.enum(["restart", "failed"]),
});

/** Refusal codes are short snake_case names; anything else is "error". */
function storeErrorCode(error: { message: string }): string {
  return /^[a-z][a-z0-9_]{0,39}$/.test(error.message) ? error.message : "error";
}

export function createSupabaseRecognitionStore(admin: SupabaseClient<Database>): RecognitionStore {
  const client = admin;
  return {
    async start(noteId, userId) {
      const { data, error } = await client.rpc("start_recognition_run", {
        p_note_id: noteId,
        // The SQL function accepts null (sweeper restarts have no person); the
        // generated type cannot express a nullable argument.
        p_user_id: userId as string,
        p_lease_seconds: RECOGNITION_LEASE_SECONDS,
      });
      if (error) return { ok: false, code: storeErrorCode(error) };
      const parsed = startRow.safeParse(data);
      if (!parsed.success) return { ok: false, code: "unexpected_result" };
      const r = parsed.data;
      return {
        ok: true,
        value: {
          outcome: r.outcome,
          runId: r.run_id,
          attempt: r.attempt,
          noteId: r.note_id,
          householdId: r.household_id,
          careChainId: r.care_chain_id,
        },
      };
    },
    async save(runId, payload) {
      const { data, error } = await client.rpc("save_care_chain_draft", {
        p_run_id: runId,
        p_draft: payload,
      });
      if (error) return { ok: false, code: storeErrorCode(error) };
      const parsed = saveRow.safeParse(data);
      if (!parsed.success) return { ok: false, code: "unexpected_result" };
      return { ok: true, value: { careChainId: parsed.data.care_chain_id } };
    },
    async fail(runId, code, retryable) {
      const { error } = await client.rpc("fail_recognition_run", {
        p_run_id: runId,
        p_reason_code: code,
        p_retryable: retryable,
      });
      if (error) return { ok: false, code: storeErrorCode(error) };
      return { ok: true, value: null };
    },
    async resumeStale(limit, householdId) {
      const { data, error } = await client.rpc("resume_stale_recognition_runs", {
        p_limit: limit,
        ...(householdId ? { p_household_id: householdId } : {}),
      });
      if (error) return { ok: false, code: storeErrorCode(error) };
      const parsed = z.array(staleRow).safeParse(data ?? []);
      if (!parsed.success) return { ok: false, code: "unexpected_result" };
      return {
        ok: true,
        value: parsed.data.map((r) => ({
          runId: r.run_id,
          noteId: r.note_id,
          householdId: r.household_id,
          attempt: r.attempt,
          action: r.action,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Service-role photo reader
// ---------------------------------------------------------------------------

/**
 * Reads a note's private photo with the service role. The note must belong to
 * the household of the run (both IDs come from `start_recognition_run`, never
 * from the browser), and the stored path must match that household and note.
 */
export function createServiceNoteImageReader(
  admin: SupabaseClient<Database>,
  fetchImpl: typeof fetch = fetch,
): RecognitionDeps["readNoteImage"] {
  return async ({ noteId, householdId }) => {
    if (!isUuid(noteId) || !isUuid(householdId)) return null;
    const { data: note, error } = await admin
      .from("notes")
      .select("id, household_id, image_path")
      .eq("id", noteId)
      .eq("household_id", householdId)
      .maybeSingle();
    if (error || !note) return null;
    const parsed = parseNoteObjectPath(note.image_path);
    if (!parsed || !isNoteObjectPathFor(note.image_path, note.household_id, note.id)) return null;
    const { data: signed, error: signError } = await admin.storage
      .from(NOTES_BUCKET)
      .createSignedUrl(note.image_path, 60);
    if (signError || !signed) return null;
    const response = await fetchImpl(signed.signedUrl, { cache: "no-store" });
    if (!response.ok) return null;
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType: parsed.contentType };
  };
}

// ---------------------------------------------------------------------------
// Default wiring
// ---------------------------------------------------------------------------

export function createDefaultRecognizer(): Recognizer {
  const admin = createAdminClient();
  return createRecognizer({
    store: createSupabaseRecognitionStore(admin),
    readNoteImage: createServiceNoteImageReader(admin),
    extract: extractCareChain,
    log: defaultLog,
    now: () => new Date(),
  });
}

/** Restarts stale runs with the default dependencies. */
export function resumeStaleRuns(limit = 20, householdId?: string): Promise<ResumeSummary> {
  return createDefaultRecognizer().resumeStaleRuns(limit, householdId);
}
