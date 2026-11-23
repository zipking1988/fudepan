import { describe, expect, it } from "vitest";
import { parseAppointmentQuote } from "./appointment-quote";

/** Fictional quotes only. */
describe("parseAppointmentQuote", () => {
  it("reads the Alpha QA note quote as a local date and clock time", () => {
    expect(parseAppointmentQuote("Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.")).toEqual({
      date: "2026-11-27",
      time: "14:30",
    });
  });

  it.each([
    ["Friday, November 27, 2026, clinic at 9 AM", { date: "2026-11-27", time: "09:00" }],
    ["27 Nov 2026 clinic 12:15 p.m.", { date: "2026-11-27", time: "12:15" }],
    ["Clinic 2026-11-27 14:30", { date: "2026-11-27", time: "14:30" }],
    ["Nov 27, 2026 clinic at 12 am", { date: "2026-11-27", time: "00:00" }],
  ])("reads %s", (quote, expected) => {
    expect(parseAppointmentQuote(quote)).toEqual(expected);
  });

  it.each([
    ["no quote", null],
    ["date only", "Fri, Nov 27, 2026 — Clinic visit"],
    ["no year", "Fri, Nov 27 — Clinic visit at 2:30 pm"],
    ["relative date", "Clinic next Friday at 2:30 pm"],
    ["vague time", "Nov 27, 2026 clinic in the morning"],
    ["noon in words", "Nov 27, 2026 clinic at noon"],
    ["am/pm missing on a one-digit hour", "Nov 27, 2026 clinic at 2:30"],
    ["numeric date with unknown day/month order", "11/12/2026 clinic at 2:30 pm"],
    ["two times", "Nov 27, 2026 clinic at 2:30 pm or 4 pm"],
    ["two dates", "Nov 27, 2026 or Nov 28, 2026 clinic at 2:30 pm"],
    ["weekday disagrees with date", "Thu, Nov 27, 2026 clinic at 2:30 pm"],
    ["named time zone", "Nov 27, 2026 clinic at 2:30 pm JST"],
    ["offset", "Nov 27, 2026 clinic at 14:30 +09:00"],
    ["impossible date", "Feb 30, 2026 clinic at 2:30 pm"],
    ["impossible time", "Nov 27, 2026 clinic at 13:30 pm"],
  ])("leaves the fields empty for %s", (_label, quote) => {
    expect(parseAppointmentQuote(quote)).toBeNull();
  });
});
