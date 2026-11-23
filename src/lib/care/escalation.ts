import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { errorCode, log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Escalation runs inside the database (Requirements 12.1, 12.2, 18.5).
 *
 * `public.escalate_due_parts` expires pending requests first, then escalates
 * high-risk Parts whose human-confirmed respond-by or task-due time has passed.
 * It writes the audit event, the ledger row (one escalation per deadline value),
 * the Feed_Item, and the reminders in one transaction. It never reads the legacy
 * `due_at` or `escalation_at` columns and never writes `approval_state`, so
 * model-guessed appointment times cannot escalate anything.
 *
 * This module only calls the function through a small injectable store.
 */

export type EscalationResult = {
  /** Escalations written in this run (one per Part and deadline value). */
  escalated: number;
  /** Pending requests that were expired first. */
  expiredRequests: number;
};

export interface EscalationStore {
  /** `householdId` null runs for every household (cron only). */
  escalateDueParts(householdId: string | null, now: Date): Promise<unknown>;
}

const resultSchema = z.object({
  escalated: z.number().int().nonnegative(),
  expired_requests: z.number().int().nonnegative(),
});

export function createSupabaseEscalationStore(admin: SupabaseClient<Database>): EscalationStore {
  return {
    async escalateDueParts(householdId, now) {
      const { data, error } = await admin.rpc("escalate_due_parts", {
        ...(householdId ? { p_household_id: householdId } : {}),
        p_now: now.toISOString(),
      });
      if (error) throw Object.assign(new Error("escalate_due_parts_failed"), { code: error.code });
      return data;
    },
  };
}

/**
 * Expires requests and escalates due Parts for one household (or all, with
 * null). Safe to call repeatedly: the ledger makes a second run a no-op.
 * Throws on failure; the sweeper catches it.
 */
export async function detectAndMarkEscalated(
  store: EscalationStore,
  householdId: string | null,
  now = new Date(),
): Promise<EscalationResult> {
  let raw: unknown;
  try {
    raw = await store.escalateDueParts(householdId, now);
  } catch (error) {
    log("error", "escalation.failed", { stage: "rpc", code: errorCode(error), household_id: householdId });
    throw error;
  }
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) {
    log("error", "escalation.failed", { stage: "result_shape", household_id: householdId });
    throw new Error("escalation_result_invalid");
  }
  const result = { escalated: parsed.data.escalated, expiredRequests: parsed.data.expired_requests };
  if (result.escalated > 0 || result.expiredRequests > 0) {
    log("info", "escalation.detected", {
      household_id: householdId,
      count: result.escalated,
    });
  }
  return result;
}
