import { describe, expect, it } from "vitest";
import {
  isRealDate,
  isValidTimeZone,
  localDate,
  normalizeDue,
  resolveTimeZone,
  zonedToIso,
} from "@/lib/datetime";

const ref = new Date("2030-01-01T03:00:00Z"); // 12:00 on 2030-01-01 in Tokyo

describe("zonedToIso", () => {
  it("produces ISO 8601 with the zone offset", () => {
    expect(zonedToIso("2030-01-05", "15:30", "Asia/Tokyo")).toBe("2030-01-05T15:30:00+09:00");
    expect(zonedToIso("2030-01-05", "15:30", "America/New_York")).toBe("2030-01-05T15:30:00-05:00");
    expect(zonedToIso("2030-07-05", "15:30", "America/New_York")).toBe("2030-07-05T15:30:00-04:00");
    expect(zonedToIso("2030-01-05", "15:30", "UTC")).toBe("2030-01-05T15:30:00+00:00");
  });
  it("returns null for impossible input", () => {
    expect(zonedToIso("2030-02-30", "10:00", "Asia/Tokyo")).toBeNull();
    expect(zonedToIso("2030-01-05", "24:00", "Asia/Tokyo")).toBeNull();
    expect(zonedToIso("2030-01-05", "10:00", "Not/AZone")).toBeNull();
  });
  it("handles half-hour offsets", () => {
    expect(zonedToIso("2030-01-05", "10:00", "Asia/Kolkata")).toBe("2030-01-05T10:00:00+05:30");
  });
});

describe("normalizeDue", () => {
  it("normalizes a full date and time", () => {
    const r = normalizeDue({
      date: "2030-01-05",
      time: "15:30",
      timeZone: "Asia/Tokyo",
      referenceDate: ref,
    });
    expect(r).toMatchObject({
      dueAt: "2030-01-05T15:30:00+09:00",
      timeDefaulted: false,
      warnings: [],
    });
  });
  it("defaults a missing time to 09:00 and flags time_not_given", () => {
    const r = normalizeDue({
      date: "2030-01-05",
      time: null,
      timeZone: "Asia/Tokyo",
      referenceDate: ref,
    });
    expect(r.dueAt).toBe("2030-01-05T09:00:00+09:00");
    expect(r.dueTime).toBe("09:00");
    expect(r.timeDefaulted).toBe(true);
    expect(r.warnings).toContain("time_not_given");
  });
  it("returns no due date when there is none", () => {
    expect(
      normalizeDue({ date: null, time: null, timeZone: "Asia/Tokyo", referenceDate: ref }),
    ).toEqual({
      dueAt: null,
      dueDate: null,
      dueTime: null,
      timeDefaulted: false,
      warnings: [],
    });
  });
  it("flags a time without a date and an impossible date", () => {
    expect(
      normalizeDue({ date: null, time: "10:00", timeZone: "UTC", referenceDate: ref }).warnings,
    ).toEqual(["invalid_date"]);
    const bad = normalizeDue({
      date: "2030-13-40",
      time: "10:00",
      timeZone: "UTC",
      referenceDate: ref,
    });
    expect(bad.dueAt).toBeNull();
    expect(bad.warnings).toEqual(["invalid_date"]);
  });
  it("flags dates before the reference day, using the user's time zone", () => {
    expect(
      normalizeDue({
        date: "2029-12-31",
        time: "10:00",
        timeZone: "Asia/Tokyo",
        referenceDate: ref,
      }).warnings,
    ).toContain("date_in_past");
    expect(
      normalizeDue({
        date: "2030-01-01",
        time: "18:00",
        timeZone: "Asia/Tokyo",
        referenceDate: ref,
      }).warnings,
    ).not.toContain("date_in_past");
  });
});

describe("time zone helpers", () => {
  it("falls back from the browser zone to DEFAULT_TIMEZONE to Asia/Tokyo", () => {
    expect(resolveTimeZone("Europe/Paris", "UTC")).toBe("Europe/Paris");
    expect(resolveTimeZone("nonsense", "America/Chicago")).toBe("America/Chicago");
    expect(resolveTimeZone(undefined, "nonsense")).toBe("Asia/Tokyo");
    expect(resolveTimeZone(null, null)).toBe("Asia/Tokyo");
  });
  it("validates zones and dates", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("x".repeat(100))).toBe(false);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2029-02-29")).toBe(false);
    expect(localDate(ref, "Asia/Tokyo")).toBe("2030-01-01");
    expect(localDate(new Date("2030-01-01T16:00:00Z"), "Asia/Tokyo")).toBe("2030-01-02");
  });
});
