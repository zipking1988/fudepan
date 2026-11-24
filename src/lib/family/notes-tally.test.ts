import { describe, expect, it } from "vitest";
import { notesTally } from "./notes-tally";
import type { SharedCareEvent } from "./shared-care-event";
const A = { id: "a", name: "Aki Sato" };
const B = { id: "b", name: "Ben Ito" };
const p = (id: string, status: string, owner: typeof A | null, extra: object = {}) =>
  ({
    id,
    title: `Task ${id}`,
    progressStatus: status,
    owner,
    driver: null,
    companion: null,
    ...extra,
  }) as never;
const ev = (noteId: string, parts: unknown[], o: object = {}) =>
  ({ noteId, state: "ready", title: `Note ${noteId}`, parts, ...o }) as unknown as SharedCareEvent;
describe("notesTally", () => {
  it("counts only completed owned tasks across notes and lists the viewer's by note", () => {
    const t = notesTally(
      [
        ev("n1", [
          p("1", "completed", A),
          p("2", "claimed", A),
          p("3", "cancelled", A),
          p("4", "completed", B),
        ]),
        ev("n2", [
          p("5", "completed", A),
          p("6", "completed", null),
          p("7", "completed", null, { driver: A }),
        ]),
        ev("n3", [p("8", "completed", A)], { state: "reading" }),
      ],
      "a",
    );
    expect(t.notes).toBe(3);
    expect(t.mine.count).toBe(2);
    expect(t.mine.byNote.map((n) => [n.noteId, n.tasks.map((x) => x.partId)])).toEqual([
      ["n1", ["1"]],
      ["n2", ["5"]],
    ]);
    expect(t.family.map((r) => [r.name, r.done, r.rank, r.tied])).toEqual([
      ["Aki Sato", 2, 1, false],
      ["Ben Ito", 1, 2, false],
    ]);
  });
  it("shares a rank on ties and shows no rows for zero completions", () => {
    const tie = notesTally([ev("n1", [p("1", "completed", A), p("2", "completed", B)])], "a");
    expect(tie.family.map((r) => [r.rank, r.tied])).toEqual([
      [1, true],
      [1, true],
    ]);
    const none = notesTally([ev("n1", [p("1", "claimed", A), p("2", "approved", B)])], "a");
    expect(none.family).toEqual([]);
    expect(none.mine).toEqual({ count: 0, byNote: [] });
  });
});
