import { describe, expect, it } from "vitest";
import { leaderboard } from "./leaderboard";
import { eventProgress } from "./dashboard";
import {
  DEMO_HOUSEHOLD_ID,
  boardParts,
  portraitFor,
  segmentStates,
  taskState,
  taskViews,
} from "./playful";
import type { EventPart, SharedCareEvent } from "./shared-care-event";

function part(over: Partial<EventPart> & { id: string }): EventPart {
  return {
    title: over.id,
    description: null,
    careCategory: "document",
    riskLevel: "low",
    progressStatus: "pending",
    sourceQuote: null,
    confidence: null,
    approvalRequired: false,
    approvalState: "not_required",
    planVersion: 1,
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
    ...over,
  } as EventPart;
}

const misa = { id: "m1", name: "Misa" };
const kenta = { id: "m2", name: "Kenta" };

function event(parts: EventPart[]): SharedCareEvent {
  const done = parts.length > 0 && parts.every((p) => p.progressStatus === "completed" || p.progressStatus === "cancelled");
  return {
    noteId: "n1",
    householdId: "h1",
    state: "ready",
    retryable: false,
    failureReason: null,
    chainId: "c1",
    title: "Friday visit",
    riskLevel: null,
    createdAt: "2026-11-20T00:00:00Z",
    parts,
    done,
  };
}

describe("portraitFor", () => {
  it("returns a portrait only for the seeded demo family", () => {
    expect(portraitFor(DEMO_HOUSEHOLD_ID, "d2000000-0000-4000-8000-000000000002")).toBe("/landing/misa.png");
    expect(portraitFor("other", "d2000000-0000-4000-8000-000000000002")).toBeNull();
    expect(portraitFor(DEMO_HOUSEHOLD_ID, "unknown")).toBeNull();
  });
});

describe("tasks and progress", () => {
  it("classifies each task and ignores cancelled ones", () => {
    const parts = [
      part({ id: "a", progressStatus: "completed", owner: misa }),
      part({ id: "b", owner: kenta }),
      part({ id: "c" }),
      part({ id: "d", progressStatus: "cancelled" }),
      part({ id: "e", careCategory: "appointment", approvalRequired: true, approvalState: "pending", owner: kenta }),
    ];
    expect(boardParts({ parts }).map((p) => p.id)).toEqual(["a", "b", "c", "e"]);
    // The cancelled row is filtered out before any state is read.
    expect(boardParts({ parts }).map(taskState)).toEqual(["done", "owned", "unassigned", "pending"]);
    const views = taskViews({ parts });
    expect(views.map((v) => v.partId)).toEqual(["a", "b", "c", "e"]);
    expect(views.find((t) => t.partId === "e")?.isMain).toBe(true);
  });

  it("handles any number of tasks, from zero to many", () => {
    expect(segmentStates(0, 0)).toEqual([]);
    expect(segmentStates(2, 4)).toEqual([true, true, false, false]);
    expect(segmentStates(7, 7)).toHaveLength(7);
    expect(eventProgress(event([part({ id: "a", progressStatus: "completed" }), part({ id: "b" })]))).toEqual({
      done: 1,
      total: 2,
    });
  });
});

describe("thanks board from completed tasks", () => {
  it("ranks by completed tasks, shares a rank on a tie, and names a Best Supporter only when all are done", () => {
    const open = event([
      part({ id: "a", progressStatus: "completed", owner: misa }),
      part({ id: "b", progressStatus: "completed", owner: kenta }),
      part({ id: "c", owner: kenta }),
    ]);
    const rows = leaderboard(open);
    expect(rows.map((r) => [r.name, r.done, r.rank, r.tied])).toEqual([
      ["Kenta", 1, 1, true],
      ["Misa", 1, 1, true],
    ]);
    expect(rows.some((r) => r.best)).toBe(false);

    const all = event([
      part({ id: "a", progressStatus: "completed", owner: misa }),
      part({ id: "b", progressStatus: "completed", owner: misa }),
      part({ id: "c", progressStatus: "completed", owner: kenta }),
    ]);
    const final = leaderboard(all);
    expect(final[0]).toMatchObject({ name: "Misa", rank: 1, best: true });
    expect(final[1]).toMatchObject({ name: "Kenta", rank: 2, best: false });
  });
});
