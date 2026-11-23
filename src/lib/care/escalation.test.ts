import { describe, expect, it, vi } from "vitest";

import { createSupabaseEscalationStore, detectAndMarkEscalated, type EscalationStore } from "./escalation";

/**
 * Escalation now runs in the database (`escalate_due_parts`). These tests cover
 * the thin TypeScript layer: it calls the function through the store and adapts
 * the result. The deadline rules themselves are tested in the pgTAP file
 * `escalation_shared.test.sql` and the pure model in `rules/escalation.test.ts`.
 *
 * Changed from the old tests: the old stub returned care_steps rows and
 * asserted direct `care_steps` updates and `audit_events` inserts driven by the
 * legacy `escalation_at` column. That behaviour is gone; this layer never
 * writes those tables.
 */

const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-11-28T00:00:00Z");

function storeReturning(data: unknown): EscalationStore & { calls: [string | null, Date][] } {
  const calls: [string | null, Date][] = [];
  return {
    calls,
    async escalateDueParts(householdId, now) {
      calls.push([householdId, now]);
      return data;
    },
  };
}

describe("detectAndMarkEscalated", () => {
  it("calls escalate_due_parts for the household and returns the counts", async () => {
    const store = storeReturning({ escalated: 2, expired_requests: 1 });
    expect(await detectAndMarkEscalated(store, HOUSEHOLD, NOW)).toEqual({ escalated: 2, expiredRequests: 1 });
    expect(store.calls).toEqual([[HOUSEHOLD, NOW]]);
  });

  it("returns zero counts when nothing is due", async () => {
    const store = storeReturning({ escalated: 0, expired_requests: 0 });
    expect(await detectAndMarkEscalated(store, HOUSEHOLD, NOW)).toEqual({ escalated: 0, expiredRequests: 0 });
  });

  it("passes null through for the all-households run", async () => {
    const store = storeReturning({ escalated: 0, expired_requests: 0 });
    await detectAndMarkEscalated(store, null, NOW);
    expect(store.calls[0][0]).toBeNull();
  });

  it("rejects an unexpected result shape instead of guessing", async () => {
    await expect(detectAndMarkEscalated(storeReturning({ escalated: "many" }), HOUSEHOLD, NOW)).rejects.toThrow();
    await expect(detectAndMarkEscalated(storeReturning(null), HOUSEHOLD, NOW)).rejects.toThrow();
  });

  it("rethrows a store failure so the sweeper can record it", async () => {
    const store: EscalationStore = { escalateDueParts: vi.fn().mockRejectedValue(new Error("boom")) };
    await expect(detectAndMarkEscalated(store, HOUSEHOLD, NOW)).rejects.toThrow("boom");
  });
});

describe("createSupabaseEscalationStore", () => {
  function adminWith(rpc: ReturnType<typeof vi.fn>) {
    return { rpc } as never;
  }

  it("calls only the escalate_due_parts function and never touches tables", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { escalated: 0, expired_requests: 0 }, error: null });
    const from = vi.fn();
    const store = createSupabaseEscalationStore({ rpc, from } as never);
    await store.escalateDueParts(HOUSEHOLD, NOW);
    expect(rpc).toHaveBeenCalledWith("escalate_due_parts", { p_household_id: HOUSEHOLD, p_now: NOW.toISOString() });
    expect(from).not.toHaveBeenCalled();
  });

  it("omits the household argument for the all-households run", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {}, error: null });
    await createSupabaseEscalationStore(adminWith(rpc)).escalateDueParts(null, NOW);
    expect(rpc).toHaveBeenCalledWith("escalate_due_parts", { p_now: NOW.toISOString() });
  });

  it("throws a code-only error when the function fails", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "P0001", message: "secret note text" } });
    const failure = await createSupabaseEscalationStore(adminWith(rpc))
      .escalateDueParts(HOUSEHOLD, NOW)
      .catch((e: Error) => e);
    expect((failure as Error).message).toBe("escalate_due_parts_failed");
  });
});

describe("regression: appointment steps with model-guessed times never escalate", () => {
  /**
   * In-memory stand-in for the database function, following its rule: only a
   * human_confirmed deadline that has passed escalates; legacy `escalation_at`
   * and model-suggested times are ignored.
   */
  type Part = {
    id: string;
    category: string;
    escalation_at: string | null;
    respond_by_at: string | null;
    respond_by_provenance: "human_confirmed" | "model_suggested" | null;
  };
  function ruleStore(parts: Part[]): EscalationStore {
    return {
      async escalateDueParts(_household, now) {
        const due = parts.filter(
          (p) =>
            p.respond_by_provenance === "human_confirmed" &&
            p.respond_by_at !== null &&
            new Date(p.respond_by_at) <= now,
        );
        return { escalated: due.length, expired_requests: 0 };
      },
    };
  }

  it("does not escalate an appointment whose only deadline is a guessed escalation_at", async () => {
    const overdue = "2026-11-27T13:00:00Z";
    const store = ruleStore([
      { id: "appt", category: "appointment", escalation_at: overdue, respond_by_at: overdue, respond_by_provenance: "model_suggested" },
      { id: "legacy", category: "appointment", escalation_at: overdue, respond_by_at: null, respond_by_provenance: null },
    ]);
    expect(await detectAndMarkEscalated(store, HOUSEHOLD, NOW)).toEqual({ escalated: 0, expiredRequests: 0 });
  });

  it("escalates only the Part with a human-confirmed deadline that has passed", async () => {
    const overdue = "2026-11-27T13:00:00Z";
    const store = ruleStore([
      { id: "appt", category: "appointment", escalation_at: overdue, respond_by_at: overdue, respond_by_provenance: "model_suggested" },
      { id: "doc", category: "document", escalation_at: null, respond_by_at: overdue, respond_by_provenance: "human_confirmed" },
    ]);
    expect((await detectAndMarkEscalated(store, HOUSEHOLD, NOW)).escalated).toBe(1);
  });
});
