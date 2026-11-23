import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@/lib/care/timeline";
import type { EventPart, MissingDetailView, SharedCareEvent } from "./shared-care-event";
import { buildThread, openQuestions, threadNeeds } from "./thread";

/** The Alpha QA note: "Fri, Nov 27 — Clinic visit at 2:30 pm. Ask Misa which clinic. …" Fake data. */
const clinic: MissingDetailView = {
  key: "p1:which_clinic",
  kind: "location",
  questionCode: "which_clinic",
  reasonCode: "missing.reason.location",
  source: "derived",
  storedDetailId: null,
  aiQuestion: null,
  personToAsk: "Misa",
} as MissingDetailView;
const time: MissingDetailView = { ...clinic, key: "p1:which_time", kind: "time", questionCode: "which_time", personToAsk: null };

function part(id: string, overrides: Partial<EventPart> = {}): EventPart {
  return {
    id,
    title: id,
    description: null,
    careCategory: "household",
    riskLevel: "low",
    progressStatus: "pending_review",
    sourceQuote: null,
    confidence: 0.9,
    approvalRequired: false,
    approvalState: "not_required",
    planVersion: 0,
    owner: null,
    driver: null,
    companion: null,
    backup: null,
    suggestedRole: null,
    personToAsk: null,
    location: null,
    confirmed: { appointment: null, respondBy: null, taskDue: null },
    suggested: { appointment: null, respondBy: null, taskDue: null },
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [],
    evidence: { required: [], attachedCount: 0, attached: [] },
    ...overrides,
  };
}

function event(parts: EventPart[], overrides: Partial<SharedCareEvent> = {}): SharedCareEvent {
  return {
    noteId: "n1",
    householdId: "h1",
    state: "ready",
    retryable: false,
    failureReason: null,
    chainId: "c1",
    title: "Clinic visit",
    riskLevel: "high",
    createdAt: "2026-11-23T11:50:20Z",
    parts,
    done: false,
    ...overrides,
  };
}

function entry(id: string, type: string, at: string, actorName: string | null, actorType = "human"): TimelineEntry {
  return { id, type, labelKey: `timeline.${type.replace(/\./g, "_")}`, params: {}, at, actorName, actorType, stepTitle: null };
}

const timeline: TimelineEntry[] = [
  entry("e1", "note.uploaded", "2026-11-23T11:50:24Z", "Haruko"),
  entry("e2", "extraction_started", "2026-11-23T11:50:24Z", "Haruko"),
  entry("e3", "extraction_succeeded", "2026-11-23T11:50:57Z", null, "ai"),
  entry("e4", "reminder.sent", "2026-11-23T12:00:00Z", null, "system"),
  entry("e5", "part.driver_volunteered", "2026-11-23T12:04:00Z", "Kenta"),
  entry("e6", "approval.reset", "2026-11-23T12:05:00Z", null, "system"),
];

const qaParts = [
  part("visit", {
    careCategory: "appointment",
    riskLevel: "high",
    approvalRequired: true,
    approvalState: "pending",
    missingDetails: [clinic, time],
  }),
  part("card", { careCategory: "document", approvalRequired: true, approvalState: "pending" }),
  part("glasses"),
];

describe("buildThread", () => {
  it("starts with Grandma's photo and Fudepan's summary of what it found", () => {
    const items = buildThread({ event: event(qaParts), timeline, viewerName: "Misa" });
    expect(items[0]).toMatchObject({ kind: "photo", actorName: "Haruko", at: "2026-11-23T11:50:24Z" });
    expect(items[1]).toMatchObject({
      kind: "bot",
      key: "thread.bot.found",
      at: "2026-11-23T11:50:57Z",
      params: { count: 3, missing: 2 },
    });
  });

  it("asks only the first open question, and says how many remain", () => {
    const items = buildThread({ event: event(qaParts), timeline, viewerName: "Misa" });
    const questions = items.filter((i) => i.kind === "question");
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ partId: "visit", remaining: 1 });
    expect(questions[0].kind === "question" && questions[0].detail.questionCode).toBe("which_clinic");
    // The note's hint is carried, never an owner.
    expect(questions[0].kind === "question" && questions[0].detail.personToAsk).toBe("Misa");
  });

  it("shows every part as a card, in order", () => {
    const items = buildThread({ event: event(qaParts), timeline, viewerName: "Misa" });
    expect(items.filter((i) => i.kind === "part").map((i) => i.kind === "part" && i.partId)).toEqual([
      "visit",
      "card",
      "glasses",
    ]);
  });

  it("turns family actions into messages, hides noise, and marks the viewer's own", () => {
    const items = buildThread({ event: event(qaParts), timeline, viewerName: "Kenta" });
    const activity = items.filter((i) => i.kind === "activity");
    expect(activity.map((i) => i.kind === "activity" && i.entry.type)).toEqual(["part.driver_volunteered"]);
    expect(activity[0].kind === "activity" && activity[0].mine).toBe(true);
    expect(items.some((i) => i.kind === "bot" && i.key === "thread.bot.approvalReset")).toBe(true);
    const other = buildThread({ event: event(qaParts), timeline, viewerName: "Misa" });
    expect(other.find((i) => i.kind === "activity")).toMatchObject({ mine: false });
  });

  it("ends with what is still needed, counted from the current state", () => {
    const items = buildThread({ event: event(qaParts), timeline, viewerName: "Misa" });
    expect(items.at(-1)).toMatchObject({
      kind: "bot",
      key: "thread.bot.stillNeeded",
      params: { unclaimed: 3, missing: 2, awaitingConfirmation: 2 },
    });
  });

  it("asks nothing and says so when no detail is missing", () => {
    const parts = [part("glasses", { owner: { id: "m1", name: "Yui" } })];
    const items = buildThread({ event: event(parts), timeline, viewerName: "Misa" });
    expect(items.find((i) => i.kind === "bot")).toMatchObject({ key: "thread.bot.foundNoMissing" });
    expect(items.some((i) => i.kind === "question")).toBe(false);
    expect(items.at(-1)).toMatchObject({ key: "thread.bot.nothingNeeded" });
  });

  it("skips questions on completed parts and celebrates when everything is done", () => {
    const done = [part("visit", { progressStatus: "completed", missingDetails: [clinic] })];
    expect(openQuestions(event(done))).toEqual([]);
    const items = buildThread({ event: event(done, { done: true }), timeline, viewerName: "Misa" });
    expect(items.at(-1)).toMatchObject({ key: "thread.bot.allDone" });
  });

  it("while the note is being read, shows only the photo and a reading message", () => {
    const items = buildThread({ event: event([], { state: "reading", chainId: null }), timeline: timeline.slice(0, 2), viewerName: "Misa" });
    expect(items.map((i) => i.kind === "bot" ? i.key : i.kind)).toEqual(["photo", "thread.bot.reading"]);
  });

  it("when reading failed, says so plainly", () => {
    const items = buildThread({ event: event([], { state: "failed", retryable: true }), timeline, viewerName: "Misa" });
    expect(items.at(-1)).toMatchObject({ key: "thread.bot.failed" });
  });

  it("does not count a legacy completed high-risk part as waiting for confirmation", () => {
    const legacy = [
      part("visit", { careCategory: "appointment", approvalRequired: true, approvalState: "approved", progressStatus: "completed" }),
    ];
    expect(threadNeeds(event(legacy))).toEqual({ unclaimed: 0, missing: 0, awaitingConfirmation: 0 });
  });
});
