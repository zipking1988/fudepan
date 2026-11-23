import { beforeEach, describe, expect, it, vi } from "vitest";

import { completeStep } from "@/app/(app)/care/actions";
import { addTextEvidence, approveStep } from "@/app/(app)/care/actions";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

/**
 * The old `/care` actions now run through the guarded part action service
 * (family-shared-care design, "Rerouting the old /care actions"). Only the edges
 * are replaced: the session, the service-role client (records every `rpc` and
 * fails any direct table write), and Next.js cache revalidation. All data is fake.
 * Task 10.5 replaces this file with fuller coverage.
 */

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const CHAIN = "a2000000-0000-4000-8000-000000000001";
const NOTE = "a1000000-0000-4000-8000-000000000001";
const STEP = "a3000000-0000-4000-8000-000000000001";
const MISA = "d1000000-0000-4000-8000-000000000002";

type RpcReply = { data: unknown; error: { message: string } | null };

const calls: { fn: string; args: Record<string, unknown> }[] = [];
let tableTouches: string[] = [];
let reply: RpcReply;

function outcome(extra: Record<string, unknown>) {
  return { care_chain_id: CHAIN, note_id: NOTE, approval_reset: false, ...extra };
}

beforeEach(() => {
  calls.length = 0;
  tableTouches = [];
  reply = { data: outcome({ outcome: "completed" }), error: null };
  vi.mocked(getSession).mockResolvedValue({ supabase: {} as never, user: { id: MISA } });
  vi.mocked(createAdminClient).mockImplementation(
    () =>
      ({
        from: (table: string) => {
          tableTouches.push(table);
          throw new Error("direct table access is not allowed");
        },
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args });
          return reply;
        },
      }) as never,
  );
  vi.mocked(revalidatePath).mockClear();
});

describe("old actions go through the guarded service", () => {
  it("completes an approved high-risk step and records step_completed in the audit trail", async () => {
    const result = await completeStep({ stepId: STEP });

    expect(result).toEqual({ ok: true, message: "Step marked as completed." });
    // The step_completed audit event is written by the SQL function, not by this action.
    expect(calls).toEqual([{ fn: "complete_part", args: { p_step_id: STEP, p_user_id: MISA } }]);
    expect(tableTouches).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith(`/care/${CHAIN}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/care/${CHAIN}/timeline`);
  });

  it("completeStep shows a committed evidence_required result as a message, not an error", async () => {
    reply = {
      data: outcome({ outcome: "evidence_required", missing: ["Receipt"] }),
      error: null,
    };
    const result = await completeStep({ stepId: STEP });
    expect(result).toEqual({
      ok: true,
      message: "Not done yet. Evidence is still needed: Receipt.",
    });
  });

  it("refuses to complete a pending high-risk step that requires approval, and writes nothing", async () => {
    reply = { data: null, error: { message: "approval_pending" } };
    const result = await completeStep({ stepId: STEP });
    expect(result).toEqual({
      ok: false,
      error:
        "This task requires confirmation before it can be marked as done. Please confirm it first.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("approveStep calls decide_approval with 'approve'", async () => {
    reply = { data: outcome({ outcome: "approved" }), error: null };
    const result = await approveStep({ stepId: STEP });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { fn: "decide_approval", args: { p_step_id: STEP, p_user_id: MISA, p_decision: "approve" } },
    ]);
  });

  it("addTextEvidence records text evidence through record_evidence", async () => {
    reply = { data: outcome({ outcome: "recorded" }), error: null };
    const result = await addTextEvidence({ stepId: STEP, text: "Picked up and handed over" });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      {
        fn: "record_evidence",
        args: {
          p_step_id: STEP,
          p_user_id: MISA,
          p_kind: "text",
          p_label: "Note",
          p_text: "Picked up and handed over",
        },
      },
    ]);
    expect(tableTouches).toEqual([]);
  });
});
