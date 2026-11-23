import { describe, expect, it } from "vitest";
import { extractionFailureMessage } from "./extraction-messages";
import { actionCount, chainStatusText, summarizeChain, type SummaryStep } from "./chain-summary";

/** Shaped like the Alpha QA chain. Fake data. */
const step = (o: Partial<SummaryStep>): SummaryStep => ({
  careCategory: "household",
  status: "pending_review",
  approvalRequired: false,
  approvalState: null,
  ownerId: null,
  appointmentLocation: null,
  appointmentTime: null,
  appointmentTimezone: null,
  ...o,
});

describe("summarizeChain", () => {
  it("counts what a fresh QA draft still needs from the family", () => {
    const s = summarizeChain([
      step({ careCategory: "appointment", approvalRequired: true }),
      step({ careCategory: "communication" }),
      step({ careCategory: "document" }),
      step({}),
    ]);
    expect(s).toMatchObject({ total: 4, done: 0, awaitingConfirmation: 1, withoutOwner: 4, missingAppointmentDetails: 1 });
    expect(s.nextAppointment).toBeNull();
    expect(actionCount(s)).toBe(6);
  });

  it("stops counting a completed high-risk appointment and shows only human-saved times", () => {
    const s = summarizeChain([
      step({
        careCategory: "appointment",
        approvalRequired: true,
        status: "completed",
        ownerId: "m1",
        appointmentLocation: "Fake Clinic",
        appointmentTime: "2026-11-27T05:30:00Z",
        appointmentTimezone: "Asia/Tokyo",
      }),
      step({ ownerId: "m1" }),
    ]);
    expect(s).toMatchObject({ done: 1, awaitingConfirmation: 0, withoutOwner: 0, missingAppointmentDetails: 0 });
    expect(s.nextAppointment).toBeNull(); // done appointments are not "next"
  });

  it("picks the earliest open appointment with a saved time zone", () => {
    const s = summarizeChain([
      step({ careCategory: "appointment", appointmentLocation: "B", appointmentTime: "2026-12-02T01:00:00Z", appointmentTimezone: "Asia/Tokyo" }),
      step({ careCategory: "appointment", appointmentLocation: "A", appointmentTime: "2026-11-30T01:00:00Z", appointmentTimezone: "Asia/Tokyo" }),
    ]);
    expect(s.nextAppointment).toEqual({ iso: "2026-11-30T01:00:00Z", timeZone: "Asia/Tokyo" });
  });
});

describe("plain wording", () => {
  it("never shows raw chain status values", () => {
    expect(chainStatusText("pending_review")).toBe("Draft, waiting for family review");
    expect(chainStatusText("escalated")).toBe("Overdue, escalated");
  });

  it("never shows raw extraction failure codes", () => {
    for (const code of ["schema_invalid", "safety_violation", "invalid_json", "completion_failed", "something_new"]) {
      const msg = extractionFailureMessage(code);
      expect(msg).not.toContain(code);
      expect(msg).toMatch(/Try again|not set up/);
    }
  });
});
