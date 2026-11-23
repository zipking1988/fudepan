import "server-only";

import {
  createSupabaseEscalationStore,
  detectAndMarkEscalated,
  type EscalationResult,
} from "@/lib/care/escalation";
import { createDefaultRecognizer, type ResumeSummary } from "@/lib/care/recognition";
import {
  createSupabaseSweepThrottle,
  RECOGNITION_SWEEP_INTERVAL_MINUTES,
  RECOGNITION_SWEEP_LIMIT,
  type SweepThrottleStore,
} from "@/lib/care/recognition-sweep";
import { errorCode, log as defaultLog, type Logger } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The household sweeper (Design K5, Requirements 12.1, 12.2, 19.2, 8.13).
 *
 * One sweep = (a) `escalate_due_parts`, which also expires pending requests,
 * and (b) resume stale recognition runs. The two steps are independent: if one
 * fails, the other still runs. The sweep is throttled per household through the
 * `household_sweeps` compare-and-set (one sweep per household per minute).
 *
 * The caller must already have checked membership (the sweep uses the service
 * role). Nothing here throws; failures are logged as stage and code only.
 */

export type SweepDeps = {
  throttle: SweepThrottleStore;
  /** `householdId` null = every household. */
  escalate: (householdId: string | null, now: Date) => Promise<EscalationResult>;
  resume: (householdId: string | null) => Promise<ResumeSummary>;
  log: Logger;
  intervalMinutes: number;
};

export type SweepResult = {
  /** False when another recent sweep of this household holds the turn. */
  swept: boolean;
  /** Null when the step failed or the sweep was throttled. */
  escalation: EscalationResult | null;
  recognition: ResumeSummary | null;
  /** Names of steps that failed, for the caller's plain message. */
  failedSteps: ("escalation" | "recognition")[];
};

export type SweepOptions = {
  now?: Date;
  /** Skip the throttle (a person pressed "check now"). Default false. */
  force?: boolean;
};

async function runSteps(
  deps: SweepDeps,
  householdId: string | null,
  now: Date,
): Promise<SweepResult> {
  const result: SweepResult = { swept: true, escalation: null, recognition: null, failedSteps: [] };
  try {
    result.escalation = await deps.escalate(householdId, now);
  } catch (error) {
    result.failedSteps.push("escalation");
    deps.log("error", "sweep.step_failed", { stage: "escalation", code: errorCode(error), household_id: householdId });
  }
  try {
    result.recognition = await deps.resume(householdId);
  } catch (error) {
    result.failedSteps.push("recognition");
    deps.log("error", "sweep.step_failed", { stage: "recognition", code: errorCode(error), household_id: householdId });
  }
  return result;
}

export function createHouseholdSweeper(deps: SweepDeps) {
  const failed = (): SweepResult => ({
    swept: false,
    escalation: null,
    recognition: null,
    failedSteps: ["escalation", "recognition"],
  });

  async function runHouseholdSweep(householdId: string, options: SweepOptions = {}): Promise<SweepResult> {
    try {
      const now = options.now ?? new Date();
      if (!options.force) {
        const olderThan = new Date(now.getTime() - deps.intervalMinutes * 60_000);
        const won = await deps.throttle.claim(householdId, now, olderThan);
        if (!won) return { swept: false, escalation: null, recognition: null, failedSteps: [] };
      }
      return await runSteps(deps, householdId, now);
    } catch (error) {
      deps.log("error", "sweep.failed", { stage: "household", code: errorCode(error), household_id: householdId });
      return failed();
    }
  }

  /** For cron: every household, not throttled per household (the cron is the only caller). */
  async function runAllHouseholdsSweep(now: Date = new Date()): Promise<SweepResult> {
    try {
      return await runSteps(deps, null, now);
    } catch (error) {
      deps.log("error", "sweep.failed", { stage: "all", code: errorCode(error) });
      return failed();
    }
  }

  return { runHouseholdSweep, runAllHouseholdsSweep };
}

function defaultSweeper() {
  const admin = createAdminClient();
  const escalationStore = createSupabaseEscalationStore(admin);
  const recognizer = createDefaultRecognizer();
  return createHouseholdSweeper({
    throttle: createSupabaseSweepThrottle(admin),
    escalate: (householdId, now) => detectAndMarkEscalated(escalationStore, householdId, now),
    resume: (householdId) =>
      householdId
        ? recognizer.resumeStaleRuns(RECOGNITION_SWEEP_LIMIT, householdId)
        : recognizer.resumeStaleRuns(RECOGNITION_SWEEP_LIMIT),
    log: defaultLog,
    intervalMinutes: RECOGNITION_SWEEP_INTERVAL_MINUTES,
  });
}

/** Sweeps one household unless it was swept within the last minute. Never throws. */
export async function runHouseholdSweep(householdId: string, options: SweepOptions = {}): Promise<SweepResult> {
  try {
    return await defaultSweeper().runHouseholdSweep(householdId, options);
  } catch (error) {
    defaultLog("error", "sweep.failed", { stage: "setup", code: errorCode(error), household_id: householdId });
    return { swept: false, escalation: null, recognition: null, failedSteps: ["escalation", "recognition"] };
  }
}

/** Sweeps every household. Used by the cron route. Never throws. */
export async function runAllHouseholdsSweep(now: Date = new Date()): Promise<SweepResult> {
  try {
    return await defaultSweeper().runAllHouseholdsSweep(now);
  } catch (error) {
    defaultLog("error", "sweep.failed", { stage: "setup", code: errorCode(error) });
    return { swept: false, escalation: null, recognition: null, failedSteps: ["escalation", "recognition"] };
  }
}
