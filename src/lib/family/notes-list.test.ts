import { describe, expect, it } from "vitest";
import { noteRow, noteStatus } from "./notes-list";
import type { SharedCareEvent } from "./shared-care-event";
const part = (status: string) => ({ progressStatus: status }) as unknown as SharedCareEvent["parts"][number];
const ev = (o: Partial<SharedCareEvent>) =>
  ({ noteId: "n", state: "ready", done: false, parts: [], title: "T", createdAt: "2026-01-01T00:00:00Z", ...o }) as SharedCareEvent;
describe("noteRow", () => {
  it("maps reading, failed, needs review and done", () => {
    expect(noteStatus(ev({ state: "reading" }))).toBe("reading");
    expect(noteStatus(ev({ state: "uploaded" }))).toBe("reading");
    expect(noteStatus(ev({ state: "failed" }))).toBe("failed");
    expect(noteStatus(ev({ parts: [part("claimed")] }))).toBe("needsReview");
    expect(noteStatus(ev({ done: true, parts: [part("completed")] }))).toBe("done");
  });
  it("counts only completed tasks as progress; claims stay at zero", () => {
    const r = noteRow(ev({ parts: [part("claimed"), part("claimed"), part("completed"), part("cancelled")] }));
    expect([r.done, r.total]).toEqual([1, 3]);
  });
});
