import { describe, expect, it } from "vitest";
import { DEMO_NOTE_LINES, LIVING_FIELDS, LIVING_NOTE, exampleDates } from "@/lib/demo/fixtures";
import { localDate } from "@/lib/datetime";
import { maskSensitive } from "@/lib/safety/mask-sensitive";

describe("living note fixture", () => {
  it("is the same note as the plain example text", () => {
    expect(LIVING_NOTE.map((line) => line.map((s) => s.text).join(""))).toEqual(DEMO_NOTE_LINES);
  });

  it("is written in Japanese, as Grandma would write it", () => {
    expect(DEMO_NOTE_LINES.join("")).toMatch(/木曜.*さくら薬局.*血圧の薬.*5時までに.*アキにたのむ/);
  });

  it("every field's source phrase is in the note, and every linked phrase has a field", () => {
    const linked = new Map<string, string>();
    for (const seg of LIVING_NOTE.flat()) {
      if (seg.field) linked.set(seg.field, `${linked.get(seg.field) ?? ""} ${seg.text}`.trim());
    }
    for (const f of LIVING_FIELDS) {
      expect(linked.get(f.id)?.replace(/\s+/g, " ")).toBe(f.source);
    }
    expect(LIVING_FIELDS.map((f) => f.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the meanings literal", () => {
    const by = Object.fromEntries(LIVING_FIELDS.map((f) => [f.id, f]));
    expect(by.deadline!.meaning).toMatch(/at the latest/);
    expect(by.deadline!.caption).toMatch(/not an appointment/);
    expect(by.who!.label).toBe("Suggested helper");
    expect(by.who!.uncertain).toBe(true);
    expect(by.when!.uncertain).toBe(true);
    expect(by.when!.check).toMatch(/Confirm which Thursday/);
    // 「5時までに」 has no 午前/午後, so AM or PM must be confirmed.
    expect(by.deadline!.uncertain).toBe(true);
    expect(by.deadline!.check).toMatch(/5 AM or 5 PM/);
    const all = JSON.stringify(LIVING_FIELDS);
    expect(all).not.toMatch(/\d+\s?%/);
    expect(maskSensitive(all).kinds).toEqual([]);
  });

  it("derives Thursday from a visible reference date", () => {
    const d = exampleDates(new Date("2030-01-01T03:00:00Z"), "Asia/Tokyo", localDate);
    expect(d.reference).toBe("2030-01-01");
    expect(d.thursday).toBe("2030-01-03");
    expect(d.referenceLabel).toBe("Tue, Jan 1");
    expect(d.thursdayLabel).toBe("Thursday, Jan 3");
  });
});
