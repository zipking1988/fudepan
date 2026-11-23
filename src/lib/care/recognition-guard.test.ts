import { describe, expect, it } from "vitest";
import { decideLegacyGuard } from "./recognition-guard";

const CHAIN = "a2000000-0000-4000-8000-000000000001";

describe("decideLegacyGuard", () => {
  it.each(["queued", "running"])("does not call ai& again while a run is %s", (status) => {
    expect(decideLegacyGuard({ status, care_chain_id: null })).toEqual({ kind: "being_read" });
  });

  it.each(["succeeded", "superseded"])("returns the existing chain for a %s run", (status) => {
    expect(decideLegacyGuard({ status, care_chain_id: CHAIN })).toEqual({
      kind: "done",
      careChainId: CHAIN,
    });
  });

  it("lets the old flow read a note with no run or a failed run", () => {
    expect(decideLegacyGuard(null)).toEqual({ kind: "proceed" });
    expect(decideLegacyGuard({ status: "failed", care_chain_id: null })).toEqual({ kind: "proceed" });
  });
});
