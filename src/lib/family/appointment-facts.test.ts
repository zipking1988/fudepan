import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@/lib/care/timeline";
import { part } from "./arbitraries.test-helpers";
import { savedAppointmentFacts } from "./appointment-facts";

const saved = (overrides: Partial<TimelineEntry> = {}): TimelineEntry => ({
  id: "t1",
  type: "appointment_clarified",
  labelKey: "timeline.appointment_clarified",
  params: { timezone: "Asia/Tokyo" },
  at: "2026-11-24T08:00:00Z",
  actorName: "Kenta",
  actorMemberId: "m1",
  actorType: "human",
  stepId: "visit",
  stepTitle: "Clinic visit",
  ...overrides,
});

const confirmedTime = { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "human_confirmed" as const };

describe("savedAppointmentFacts", () => {
  const visit = part("visit", {
    careCategory: "appointment",
    location: "Midori QA Clinic",
    confirmed: { appointment: confirmedTime, respondBy: null, taskDue: null },
  });

  it("returns the saved place and confirmed time with the newest saver of this Part", () => {
    const older = saved({ id: "t0", at: "2026-11-24T07:00:00Z", actorName: "Misa", actorMemberId: "m2" });
    const otherPart = saved({ id: "t2", at: "2026-11-24T09:00:00Z", stepId: "glasses", actorName: "Aki" });
    expect(savedAppointmentFacts(visit, [older, saved(), otherPart])).toEqual({
      place: "Midori QA Clinic",
      time: confirmedTime,
      savedBy: { name: "Kenta", memberId: "m1", at: "2026-11-24T08:00:00Z" },
    });
  });

  it("keeps showing the facts on a completed Part", () => {
    const done = { ...visit, progressStatus: "completed" };
    expect(savedAppointmentFacts(done, [saved()])?.place).toBe("Midori QA Clinic");
  });

  it("never shows a time the note or the model only suggested", () => {
    const suggestedOnly = part("visit", {
      careCategory: "appointment",
      sourceQuote: "11/27 14:30 clinic",
      suggested: { appointment: { ...confirmedTime, provenance: "model_suggested" }, respondBy: null, taskDue: null },
      confirmed: { appointment: { ...confirmedTime, provenance: "model_suggested" }, respondBy: null, taskDue: null },
    });
    expect(savedAppointmentFacts(suggestedOnly, [])).toBeNull();
    const placeOnly = { ...suggestedOnly, location: "Midori QA Clinic" };
    expect(savedAppointmentFacts(placeOnly, [])).toEqual({ place: "Midori QA Clinic", time: null, savedBy: null });
  });

  it("is null for other kinds of Parts and for a blank place", () => {
    expect(savedAppointmentFacts(part("glasses", { location: "Shop" }), [saved({ stepId: "glasses" })])).toBeNull();
    expect(savedAppointmentFacts(part("visit", { careCategory: "appointment", location: "  " }), [saved()])).toBeNull();
  });

  it("takes the saver only from a human audit actor, never from the payload", () => {
    const system = saved({ actorType: "system", actorName: null, actorMemberId: null });
    expect(savedAppointmentFacts(visit, [system])?.savedBy).toBeNull();
  });
});
