import { describe, expect, it } from "vitest";

import {
  buildAppointmentClarificationInput,
  isValidTimeZone,
  parseAppointmentClarifiedPayload,
  wallClockInZone,
  zonedTimeToInstant,
} from "./appointment";

const STEP = "a3000000-0000-4000-8000-000000000001";

describe("zonedTimeToInstant", () => {
  it("returns the instant for a wall-clock time in a named zone", () => {
    expect(zonedTimeToInstant("2026-12-05", "10:00", "Asia/Tokyo")).toEqual({
      ok: true,
      instant: new Date("2026-12-05T01:00:00Z"),
    });
    expect(zonedTimeToInstant("2026-07-01", "09:30", "Europe/London")).toEqual({
      ok: true,
      instant: new Date("2026-07-01T08:30:00Z"),
    });
  });

  it("refuses a time skipped by a daylight saving change", () => {
    expect(zonedTimeToInstant("2026-03-08", "02:30", "America/New_York")).toEqual({
      ok: false,
      reason: "nonexistent_time",
    });
  });

  it("uses the earlier of a repeated hour", () => {
    const result = zonedTimeToInstant("2026-11-01", "01:30", "America/New_York");
    expect(result).toEqual({ ok: true, instant: new Date("2026-11-01T05:30:00Z") });
  });

  it("refuses dates that are not on the calendar or out of range", () => {
    expect(zonedTimeToInstant("2026-02-30", "10:00", "Asia/Tokyo")).toEqual({ ok: false, reason: "invalid_date" });
    expect(zonedTimeToInstant("0026-12-05", "10:00", "Asia/Tokyo")).toEqual({ ok: false, reason: "invalid_date" });
    expect(zonedTimeToInstant("2026-12-05", "24:00", "Asia/Tokyo")).toEqual({ ok: false, reason: "invalid_time" });
  });

  it("round-trips through wallClockInZone", () => {
    const result = zonedTimeToInstant("2026-12-31", "23:45", "Pacific/Auckland");
    if (!result.ok) throw new Error("expected ok");
    expect(wallClockInZone(result.instant, "Pacific/Auckland")).toEqual({ date: "2026-12-31", time: "23:45" });
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA names and refuses offsets and unknown zones", () => {
    expect(isValidTimeZone("Asia/Tokyo")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("+09:00")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});

describe("buildAppointmentClarificationInput (what the card sends)", () => {
  const base = { stepId: STEP, location: " Fake Clinic ", localDate: "2026-12-05", localTime: "10:00", timeZone: "Asia/Tokyo" };

  it("sends an ISO instant in UTC plus the zone and the typed date and time", () => {
    expect(buildAppointmentClarificationInput(base)).toEqual({
      ok: true,
      input: {
        stepId: STEP,
        location: "Fake Clinic",
        appointmentAt: "2026-12-05T01:00:00.000Z",
        timeZone: "Asia/Tokyo",
        localDate: "2026-12-05",
        localTime: "10:00",
      },
    });
  });

  it("names every missing field", () => {
    expect(buildAppointmentClarificationInput({ ...base, location: "", localDate: "", localTime: "" })).toEqual({
      ok: false,
      error: "Please add the hospital or clinic name, appointment date and appointment time.",
    });
    expect(buildAppointmentClarificationInput({ ...base, localTime: "" })).toEqual({
      ok: false,
      error: "Please add the appointment time.",
    });
  });

  it("says why when the device zone is unknown", () => {
    const result = buildAppointmentClarificationInput({ ...base, timeZone: null });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("time zone could not be read");
  });

  it("explains a time skipped by the clocks changing", () => {
    expect(
      buildAppointmentClarificationInput({ ...base, localDate: "2026-03-08", localTime: "02:30", timeZone: "America/New_York" }),
    ).toEqual({
      ok: false,
      error: "02:30 on 2026-03-08 does not exist in America/New York time because the clocks change that day. Please check the time.",
    });
  });
});

describe("parseAppointmentClarifiedPayload", () => {
  const payload = {
    location: "Fake Clinic",
    appointment_time: "2026-12-05T01:00:00Z",
    timezone: "Asia/Tokyo",
    clarified_by: "d1000000-0000-4000-8000-000000000002",
    clarified_by_member_id: "d2000000-0000-4000-8000-000000000002",
    previous: null,
  };

  it("reads the payload the SQL function writes", () => {
    expect(parseAppointmentClarifiedPayload(payload)).toMatchObject({
      location: "Fake Clinic",
      appointment_time: "2026-12-05T01:00:00Z",
      timezone: "Asia/Tokyo",
      previous: null,
    });
  });

  it("returns null for a malformed payload rather than guessing", () => {
    expect(parseAppointmentClarifiedPayload({ ...payload, appointment_time: "2026-12-05T10:00:00" })).toBeNull();
    expect(parseAppointmentClarifiedPayload({ location: "Fake Clinic" })).toBeNull();
  });
});
