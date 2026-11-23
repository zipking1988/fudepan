import { beforeEach, describe, expect, it, vi } from "vitest";

/** runEscalationCheck verifies membership first, then goes through the household sweep. */
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { runHouseholdSweep } = vi.hoisted(() => ({ runHouseholdSweep: vi.fn() }));
vi.mock("@/lib/family/sweep", () => ({ runHouseholdSweep }));

import { getSession } from "@/lib/auth/session";
import { runEscalationCheck } from "./actions";

const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";

function session(user: { id: string } | null, membership: { id: string } | null) {
  vi.mocked(getSession).mockResolvedValue({
    user,
    supabase: {
      from: () => {
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: membership }) };
        return { select: () => chain };
      },
    },
  } as never);
}

beforeEach(() => {
  runHouseholdSweep.mockReset();
});

describe("runEscalationCheck", () => {
  it("refuses a signed-out person without sweeping", async () => {
    session(null, null);
    expect(await runEscalationCheck(HOUSEHOLD)).toMatchObject({ ok: false });
    expect(runHouseholdSweep).not.toHaveBeenCalled();
  });

  it("refuses a person who is not a member of the household without sweeping", async () => {
    session({ id: "u" }, null);
    expect(await runEscalationCheck(HOUSEHOLD)).toEqual({
      ok: false,
      error: "You are not a member of this household.",
    });
    expect(runHouseholdSweep).not.toHaveBeenCalled();
  });

  it("sweeps the verified household without the throttle and returns the escalation count", async () => {
    session({ id: "u" }, { id: "m" });
    runHouseholdSweep.mockResolvedValue({
      swept: true,
      escalation: { escalated: 2, expiredRequests: 1 },
      recognition: { restarted: 0, failed: 0, errors: 0 },
      failedSteps: [],
    });
    expect(await runEscalationCheck(HOUSEHOLD)).toEqual({ ok: true, count: 2 });
    expect(runHouseholdSweep).toHaveBeenCalledWith(HOUSEHOLD, { force: true });
  });

  it("returns a plain error when the escalation step failed", async () => {
    session({ id: "u" }, { id: "m" });
    runHouseholdSweep.mockResolvedValue({
      swept: true,
      escalation: null,
      recognition: null,
      failedSteps: ["escalation"],
    });
    const result = await runEscalationCheck(HOUSEHOLD);
    expect(result.ok).toBe(false);
  });
});
