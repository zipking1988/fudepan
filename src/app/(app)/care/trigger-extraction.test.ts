import { beforeEach, describe, expect, it, vi } from "vitest";

/** The old triggerExtraction must not call ai& for a note that recognition already handles. */
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { runExtraction, checkLegacyGuard } = vi.hoisted(() => ({ runExtraction: vi.fn(), checkLegacyGuard: vi.fn() }));
vi.mock("@/lib/care/extraction", () => ({ runExtraction }));
vi.mock("@/lib/care/recognition-guard", () => ({ checkLegacyGuard }));

import { getSession } from "@/lib/auth/session";
import { triggerExtraction } from "./actions";

const NOTE = "a1000000-0000-4000-8000-000000000001";
const CHAIN = "a2000000-0000-4000-8000-000000000001";

beforeEach(() => {
  runExtraction.mockReset();
  checkLegacyGuard.mockReset();
  vi.mocked(getSession).mockResolvedValue({
    user: { id: "u" },
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: NOTE } }) }) }),
      }),
    },
  } as never);
});

describe("triggerExtraction guard", () => {
  it("returns a plain message and skips ai& while recognition is active", async () => {
    checkLegacyGuard.mockResolvedValue({ kind: "being_read" });
    const result = await triggerExtraction(NOTE);
    expect(result).toMatchObject({ ok: false, state: "reading" });
    expect(runExtraction).not.toHaveBeenCalled();
  });

  it("returns the existing chain without calling ai& when a run succeeded", async () => {
    checkLegacyGuard.mockResolvedValue({ kind: "done", careChainId: CHAIN });
    expect(await triggerExtraction(NOTE)).toEqual({ ok: true, careChainId: CHAIN });
    expect(runExtraction).not.toHaveBeenCalled();
  });

  it("still runs the old flow when there is no active or finished run", async () => {
    checkLegacyGuard.mockResolvedValue({ kind: "proceed" });
    runExtraction.mockResolvedValue({ ok: true, careChainId: CHAIN });
    expect(await triggerExtraction(NOTE)).toEqual({ ok: true, careChainId: CHAIN });
    expect(runExtraction).toHaveBeenCalledTimes(1);
  });
});
