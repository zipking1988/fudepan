import { describe, expect, it } from "vitest";
import { isEventDone, selectEventChain } from "./shared-care-event";

const chain = (id: string, status: string, createdAt: string) => ({ id, status, createdAt });

describe("selectEventChain", () => {
  it("picks the newest chain that is not extraction_failed", () => {
    const sel = selectEventChain([
      chain("a", "pending_review", "2026-11-20T00:00:00Z"),
      chain("b", "in_progress", "2026-11-22T00:00:00Z"),
      chain("c", "pending_review", "2026-11-21T00:00:00Z"),
    ]);
    expect(sel).toMatchObject({ state: "ready", chain: { id: "b" }, retryable: false });
  });

  it("falls back to the previous usable chain when the newest one failed", () => {
    const sel = selectEventChain([
      chain("old", "pending_review", "2026-11-20T00:00:00Z"),
      chain("new", "extraction_failed", "2026-11-22T00:00:00Z"),
    ]);
    expect(sel.state).toBe("ready");
    expect(sel.chain?.id).toBe("old");
  });

  it("is ready even while a later run is active", () => {
    const sel = selectEventChain(
      [chain("a", "pending_review", "2026-11-20T00:00:00Z")],
      [{ status: "running", createdAt: "2026-11-23T00:00:00Z" }],
    );
    expect(sel.state).toBe("ready");
  });

  it("is reading when a run is active and no chain is usable", () => {
    expect(
      selectEventChain([chain("x", "extraction_failed", "2026-11-20T00:00:00Z")], [
        { status: "failed", createdAt: "2026-11-20T00:00:00Z" },
        { status: "queued", createdAt: "2026-11-21T00:00:00Z" },
      ]),
    ).toMatchObject({ state: "reading", chain: null, retryable: false });
  });

  it("is failed and retryable when the latest run failed", () => {
    expect(
      selectEventChain([], [
        { status: "failed", createdAt: "2026-11-21T00:00:00Z", failureReason: "timeout" },
        { status: "failed", createdAt: "2026-11-20T00:00:00Z", failureReason: "invalid_json" },
      ]),
    ).toMatchObject({ state: "failed", retryable: true, failureReason: "timeout" });
  });

  it("uses the note status for legacy notes without runs", () => {
    expect(selectEventChain([], [], "extraction_failed")).toMatchObject({ state: "failed", retryable: true });
    expect(selectEventChain([], [], "extracting").state).toBe("reading");
  });

  it("is uploaded when nothing has happened yet", () => {
    expect(selectEventChain([])).toMatchObject({ state: "uploaded", chain: null, retryable: false });
    expect(selectEventChain([], [], "uploaded").state).toBe("uploaded");
  });
});

describe("isEventDone", () => {
  it("is done only when every part is completed or cancelled", () => {
    expect(isEventDone([{ progressStatus: "completed" }, { progressStatus: "cancelled" }])).toBe(true);
    expect(isEventDone([{ progressStatus: "completed" }, { progressStatus: "in_progress" }])).toBe(false);
    expect(isEventDone([])).toBe(false);
  });
});
