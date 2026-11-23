import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  deriveMissingDetails,
  eventNeedsSomeone,
  isStoredDetailResolved,
  showsNeedsDetails,
  type MissingDetailPart,
  type StoredMissingDetail,
} from "@/lib/care/rules/missing-details";

function part(overrides: Partial<MissingDetailPart> = {}): MissingDetailPart {
  return {
    id: "p1",
    householdId: "h1",
    careCategory: "appointment",
    riskLevel: "medium",
    approvalRequired: false,
    storedApprovalState: null,
    legacyStatus: "pending_review",
    ownerId: null,
    driverId: null,
    companionId: null,
    backupOwnerId: null,
    taskDue: null,
    respondBy: null,
    evidenceRequired: [],
    evidenceAttached: [],
    planVersion: 1,
    rejectedAtPlanVersion: null,
    location: null,
    appointmentTime: null,
    appointmentDate: null,
    requiredAmountMinor: null,
    personToAsk: null,
    ...overrides,
  };
}

function stored(overrides: Partial<StoredMissingDetail> = {}): StoredMissingDetail {
  return {
    id: "d1",
    kind: "location",
    questionCode: "which_clinic",
    aiQuestion: null,
    resolvedAt: null,
    resolvedBy: null,
    answer: null,
    ...overrides,
  };
}

const confirmed = (provenance: "human_confirmed" | "model_suggested") => ({
  at: new Date("2026-11-27T05:30:00Z"),
  timeZone: "Asia/Tokyo",
  provenance,
});

describe("deriveMissingDetails", () => {
  it("QA: 'Ask Misa which clinic' gives a place detail with the hint and no owner", () => {
    const p = part({ personToAsk: "Misa", appointmentDate: "2026-11-27" });
    const details = deriveMissingDetails(p, [stored({ aiQuestion: "Which clinic?" })]);
    const place = details.find((d) => d.kind === "location");
    expect(place).toMatchObject({ questionCode: "which_clinic", personToAsk: "Misa", needsDetails: true });
    expect(p.ownerId).toBeNull();
    expect(p.driverId).toBeNull();
    expect(p.companionId).toBeNull();
    expect(details.filter((d) => d.kind === "location")).toHaveLength(1);
    expect(details.every((d) => d.kind === "location" || d.personToAsk === null)).toBe(true);
  });

  it("derives place and time for an appointment with neither, each with question and reason", () => {
    const details = deriveMissingDetails(part(), []);
    expect(details.map((d) => d.kind)).toEqual(["location", "time"]);
    for (const d of details) {
      expect(d.questionCode).toBeTruthy();
      expect(d.reasonCode).toBeTruthy();
    }
    expect(showsNeedsDetails(details)).toBe(true);
  });

  it("a model-suggested time does not answer the time detail; a human-confirmed one does", () => {
    const withModel = deriveMissingDetails(
      part({ location: "Clinic", appointmentTime: confirmed("model_suggested") }),
      [],
    );
    expect(withModel.map((d) => d.kind)).toEqual(["time"]);
    const withHuman = deriveMissingDetails(
      part({ location: "Clinic", appointmentTime: confirmed("human_confirmed") }),
      [],
    );
    expect(withHuman).toEqual([]);
  });

  it("a resolved stored time row without a confirmed time keeps the time detail", () => {
    const row = stored({
      kind: "time",
      questionCode: "which_time",
      resolvedAt: "2026-11-01T00:00:00Z",
      resolvedBy: "m1",
      answer: "2:30 pm",
    });
    const details = deriveMissingDetails(part({ location: "Clinic" }), [row]);
    expect(details.map((d) => d.kind)).toEqual(["time"]);
  });

  it("a stored detail is resolved only by a human answer", () => {
    expect(isStoredDetailResolved(stored({ resolvedAt: "x", resolvedBy: "m1", answer: "Sakura Clinic" }))).toBe(true);
    expect(isStoredDetailResolved(stored({ resolvedAt: "x", resolvedBy: null, answer: "Sakura Clinic" }))).toBe(false);
    expect(isStoredDetailResolved(stored({ resolvedAt: "x", resolvedBy: "m1", answer: "  " }))).toBe(false);
    const resolved = stored({ resolvedAt: "x", resolvedBy: "m1", answer: "Sakura Clinic" });
    expect(deriveMissingDetails(part({ appointmentTime: confirmed("human_confirmed") }), [resolved])).toEqual([]);
  });

  it("shows 'No driver yet' for transport without a Driver", () => {
    const details = deriveMissingDetails(part({ careCategory: "transport" }), []);
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({ questionCode: "who_will_drive", reasonCode: "missing.reason.driver" });
    expect(deriveMissingDetails(part({ careCategory: "transport", driverId: "m2" }), [])).toEqual([]);
  });

  it("asks for the amount of a payment Part", () => {
    expect(deriveMissingDetails(part({ careCategory: "payment" }), []).map((d) => d.kind)).toEqual(["amount"]);
    expect(deriveMissingDetails(part({ careCategory: "payment", requiredAmountMinor: 500 }), [])).toEqual([]);
  });

  it("a high-risk Part with no human-confirmed time has a deadline detail", () => {
    const base = { careCategory: "household" as const, riskLevel: "high" as const };
    expect(deriveMissingDetails(part(base), []).map((d) => d.reasonCode)).toEqual(["missing.reason.deadline"]);
    expect(deriveMissingDetails(part({ ...base, taskDue: confirmed("model_suggested") }), [])).toHaveLength(1);
    expect(deriveMissingDetails(part({ ...base, taskDue: confirmed("human_confirmed") }), [])).toEqual([]);
  });
});

describe("eventNeedsSomeone", () => {
  const done = { careCategory: "household" as const, ownerId: "m1" };

  it("includes unclaimed low and medium risk Parts", () => {
    for (const riskLevel of ["low", "medium"] as const) {
      const p = part({ careCategory: "household", riskLevel });
      expect(eventNeedsSomeone([{ part: p, details: deriveMissingDetails(p, []) }])).toBe(true);
    }
  });

  it("excludes an event whose Parts are all claimed with no gaps", () => {
    const p = part(done);
    expect(eventNeedsSomeone([{ part: p, details: deriveMissingDetails(p, []) }])).toBe(false);
  });

  it("includes a claimed Part with an unresolved detail or a high-risk Part with no confirmed time", () => {
    const a = part({ ...done, careCategory: "appointment" });
    expect(eventNeedsSomeone([{ part: a, details: deriveMissingDetails(a, []) }])).toBe(true);
    const b = part({ ...done, riskLevel: "high" });
    expect(eventNeedsSomeone([{ part: b, details: [] }])).toBe(true);
  });

  it("property: membership equals unclaimed OR unresolved detail OR high risk without confirmed time", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("low", "medium", "high"),
        fc.constantFrom("appointment", "transport", "payment", "household", "medication"),
        fc.option(fc.constant("m1"), { nil: null }),
        fc.boolean(),
        (riskLevel, careCategory, ownerId, human) => {
          const p = part({
            riskLevel,
            careCategory,
            ownerId,
            driverId: "m2",
            location: "Clinic",
            appointmentTime: confirmed("human_confirmed"),
            requiredAmountMinor: 100,
            taskDue: human ? confirmed("human_confirmed") : null,
          });
          const details = deriveMissingDetails(p, []);
          const expected = ownerId === null || (riskLevel === "high" && !human);
          expect(eventNeedsSomeone([{ part: p, details }])).toBe(expected);
        },
      ),
    );
  });
});
