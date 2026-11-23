import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorCode, log as defaultLog, type Logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createDefaultRecognizer, type ResumeSummary } from "./recognition";

/**
 * Throttled trigger for the recognition sweeper (Design K5).
 *
 * `maybeSweepRecognition(householdId)` restarts stale recognition runs of one
 * household, but at most once per interval. The throttle is the
 * `household_sweeps` row: whoever moves `last_run_at` forward wins the turn, so
 * several people opening the app at once cause one sweep.
 *
 * The caller must already have checked that the person belongs to the
 * household (the function uses the service role). Call it inside `after()` so
 * the page does not wait. It never throws and logs IDs and counts only.
 */

export const RECOGNITION_SWEEP_INTERVAL_MINUTES = 1;
export const RECOGNITION_SWEEP_LIMIT = 10;
const SWEEP_LIMIT = RECOGNITION_SWEEP_LIMIT;

export interface SweepThrottleStore {
  /** True when this caller now holds the turn (the row was created or moved forward). */
  claim(householdId: string, now: Date, olderThan: Date): Promise<boolean>;
}

export type RecognitionSweepDeps = {
  throttle: SweepThrottleStore;
  resume: (householdId: string) => Promise<ResumeSummary>;
  log: Logger;
  now: () => Date;
  intervalMinutes: number;
};

export type SweepOutcome =
  | { swept: true; summary: ResumeSummary }
  | { swept: false; reason: "throttled" | "error" };

export function createSupabaseSweepThrottle(admin: SupabaseClient<Database>): SweepThrottleStore {
  return {
    async claim(householdId, now, olderThan) {
      const { data: row, error } = await admin
        .from("household_sweeps")
        .select("last_run_at")
        .eq("household_id", householdId)
        .maybeSingle();
      if (error) throw new Error("sweep_read_failed");

      if (!row) {
        const { error: insertError } = await admin
          .from("household_sweeps")
          .insert({ household_id: householdId, last_run_at: now.toISOString() });
        if (!insertError) return true;
        if (insertError.code === "23505") return false; // another request inserted first
        throw new Error("sweep_insert_failed");
      }

      if (new Date(row.last_run_at).getTime() > olderThan.getTime()) return false;

      // Compare and set: only the request that still sees the old value wins.
      const { data: moved, error: updateError } = await admin
        .from("household_sweeps")
        .update({ last_run_at: now.toISOString() })
        .eq("household_id", householdId)
        .eq("last_run_at", row.last_run_at)
        .select("household_id");
      if (updateError) throw new Error("sweep_update_failed");
      return (moved?.length ?? 0) > 0;
    },
  };
}

export function createRecognitionSweeper(deps: RecognitionSweepDeps) {
  return async function maybeSweep(householdId: string): Promise<SweepOutcome> {
    try {
      const now = deps.now();
      const olderThan = new Date(now.getTime() - deps.intervalMinutes * 60_000);
      const won = await deps.throttle.claim(householdId, now, olderThan);
      if (!won) return { swept: false, reason: "throttled" };
      const summary = await deps.resume(householdId);
      return { swept: true, summary };
    } catch (error) {
      deps.log("error", "recognition_sweep.failed", {
        stage: "sweep",
        code: errorCode(error),
        household_id: householdId,
      });
      return { swept: false, reason: "error" };
    }
  };
}

/** Resumes stale runs of this household unless one was resumed within the last interval. */
export function maybeSweepRecognition(householdId: string): Promise<SweepOutcome> {
  const admin = createAdminClient();
  const recognizer = createDefaultRecognizer();
  return createRecognitionSweeper({
    throttle: createSupabaseSweepThrottle(admin),
    resume: (id) => recognizer.resumeStaleRuns(SWEEP_LIMIT, id),
    log: defaultLog,
    now: () => new Date(),
    intervalMinutes: RECOGNITION_SWEEP_INTERVAL_MINUTES,
  })(householdId);
}
