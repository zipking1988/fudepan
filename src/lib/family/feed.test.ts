import { describe, expect, it } from "vitest";
import { deriveMissingDetails } from "@/lib/care/rules/missing-details";
import type { EventPart, SharedCareEvent } from "./shared-care-event";
import { buildFeed, countParts, type FeedItemRow } from "./feed";

const HOUSEHOLD = "h1";
const ME = "m-me";
const NOW = new Date("2026-11-20T00:00:00Z");

function part(over: Partial<EventPart> & { id: string }): EventPart {
  return {
    title: "Part title",
    description: null,
    careCategory: "household",
    riskLevel: "low",
    progressStatus: "pending_review",
    sourceQuote: null,
    confidence: null,
    approvalRequired: false,
    approvalState: "not_required",
    planVersion: 1,
    owner: { id: "o1", name: "Ken" },
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
    evidence: { required: [], attached: [], attachedCount: 0 },
    ...over,
  };
}

function event(noteId: string, over: Partial<SharedCareEvent> = {}): SharedCareEvent {
  const parts = over.parts ?? [];
  return {
    noteId,
    householdId: HOUSEHOLD,
    state: "ready",
    retryable: false,
    failureReason: null,
    chainId: `c-${noteId}`,
    title: `Title ${noteId}`,
    riskLevel: "low",
    createdAt: "2026-11-01T00:00:00Z",
    parts,
    done: parts.length > 0 && parts.every((p) => p.progressStatus === "completed" || p.progressStatus === "cancelled"),
    ...over,
  };
}

let seq = 0;
function item(noteId: string | null, kind: string, createdAt: string, extra: Partial<FeedItemRow> = {}): FeedItemRow {
  seq += 1;
  return {
    id: `i${String(seq).padStart(3, "0")}`,
    noteId,
    careChainId: null,
    kind,
    createdAt,
    recipientMemberId: null,
    seenAt: null,
    ...extra,
  };
}

const feedOf = (rows: FeedItemRow[], events: SharedCareEvent[], lastSeen: string | null = null) =>
  buildFeed(rows, new Map(events.map((e) => [e.noteId, e])), NOW, lastSeen, ME);

describe("buildFeed", () => {
  it("orders events by newest activity, one event per note", () => {
    const feed = feedOf(
      [
        item("a", "event_created", "2026-11-10T00:00:00Z"),
        item("b", "event_created", "2026-11-12T00:00:00Z"),
        item("a", "part_claimed", "2026-11-14T00:00:00Z"),
      ],
      [event("a", { parts: [part({ id: "p1" })] }), event("b", { parts: [part({ id: "p2" })] })],
    );
    expect(feed.events.map((e) => e.noteId)).toEqual(["a", "b"]);
    expect(feed.events[0].latestActivityAt).toBe("2026-11-14T00:00:00Z");
    expect(feed.events[0].latestKind).toBe("part_claimed");
  });

  it("shows 'Being read' for event_created and replaces it with the title once ready", () => {
    const reading = feedOf(
      [item("a", "event_created", "2026-11-10T00:00:00Z")],
      [event("a", { state: "uploaded", chainId: null, title: null })],
    ).events[0];
    expect(reading).toMatchObject({ state: "reading", title: null, titleKey: "feed.heading.beingRead", chainId: null });

    const ready = feedOf(
      [item("a", "event_created", "2026-11-10T00:00:00Z"), item("a", "event_ready", "2026-11-10T00:01:00Z")],
      [event("a", { parts: [part({ id: "p1" })] })],
    ).events[0];
    expect(ready).toMatchObject({ state: "ready", title: "Title a", titleKey: null, chainId: "c-a" });
  });

  it("flags failed reading for retry and never exposes a title", () => {
    const failed = feedOf(
      [item("a", "event_created", "2026-11-10T00:00:00Z"), item("a", "event_unreadable", "2026-11-10T00:02:00Z")],
      [event("a", { state: "failed", chainId: null, title: "secret", retryable: true })],
    ).events[0];
    expect(failed).toMatchObject({ state: "failed", retry: true, title: null, titleKey: "feed.couldNotRead" });
    const uploadedFailed = feedOf(
      [item("a", "event_unreadable", "2026-11-10T00:02:00Z")],
      [event("a", { state: "uploaded", chainId: null, title: null })],
    ).events[0];
    expect(uploadedFailed.state).toBe("failed");
  });

  it("puts unclaimed and missing-detail events in 'Needs someone' above the rest", () => {
    const unclaimed = part({ id: "u", owner: null });
    const fine = part({ id: "f" });
    const withDetail = part({
      id: "d",
      careCategory: "appointment",
      location: null,
      missingDetails: deriveMissingDetails(
        {
          id: "d", householdId: HOUSEHOLD, careCategory: "appointment", riskLevel: "low", approvalRequired: false,
          storedApprovalState: null, legacyStatus: "pending_review", ownerId: "o1", driverId: null, companionId: null,
          backupOwnerId: null, taskDue: null, respondBy: null, evidenceRequired: [], evidenceAttached: [], planVersion: 1,
          rejectedAtPlanVersion: null, location: null, appointmentTime: null, appointmentDate: null,
          requiredAmountMinor: null, personToAsk: null,
        },
        [],
      ),
    });
    const feed = feedOf(
      [
        item("ok", "event_ready", "2026-11-15T00:00:00Z"),
        item("un", "event_ready", "2026-11-11T00:00:00Z"),
        item("md", "event_ready", "2026-11-12T00:00:00Z"),
      ],
      [event("ok", { parts: [fine] }), event("un", { parts: [unclaimed] }), event("md", { parts: [withDetail] })],
    );
    expect(feed.needsSomeone.map((e) => e.noteId)).toEqual(["md", "un"]);
    expect(feed.other.map((e) => e.noteId)).toEqual(["ok"]);
    expect(feed.events.map((e) => e.noteId)).toEqual(["md", "un", "ok"]);
  });

  it("keeps a high-risk Part without a confirmed deadline in 'Needs someone'", () => {
    const high = part({ id: "h", riskLevel: "high" });
    const feed = feedOf([item("a", "event_ready", "2026-11-10T00:00:00Z")], [event("a", { parts: [high] })]);
    expect(feed.events[0].needsSomeone).toBe(true);
  });

  it("marks unseen against last_seen_at and treats a missing state as all new", () => {
    const rows = [item("a", "event_ready", "2026-11-10T00:00:00Z"), item("b", "event_ready", "2026-11-12T00:00:00Z")];
    const evs = [event("a", { parts: [part({ id: "1" })] }), event("b", { parts: [part({ id: "2" })] })];
    const seen = feedOf(rows, evs, "2026-11-11T00:00:00Z");
    expect(seen.events.map((e) => [e.noteId, e.unseen])).toEqual([["b", true], ["a", false]]);
    expect(seen.newCount).toBe(1);
    expect(feedOf(rows, evs, null).newCount).toBe(2);
    expect(feedOf(rows, evs, "2026-11-12T00:00:00Z").newCount).toBe(0);
  });

  it("lists only the member's own reminders and counts the unseen ones", () => {
    const feed = feedOf(
      [
        item("a", "event_ready", "2026-11-10T00:00:00Z"),
        item("a", "reminder", "2026-11-11T00:00:00Z", { recipientMemberId: ME }),
        item("a", "reminder", "2026-11-12T00:00:00Z", { recipientMemberId: ME, seenAt: "2026-11-13T00:00:00Z" }),
        item("a", "reminder", "2026-11-12T00:00:00Z", { recipientMemberId: "someone-else" }),
      ],
      [event("a", { parts: [part({ id: "1" })] })],
    );
    expect(feed.reminders).toHaveLength(2);
    expect(feed.reminders[0].createdAt).toBe("2026-11-12T00:00:00Z");
    expect(feed.unseenReminderCount).toBe(1);
    // A reminder does not make the event's household activity newer or unseen.
    expect(feed.events[0].latestKind).toBe("event_ready");
  });

  it("skips notes whose event is not visible (other household)", () => {
    const feed = feedOf([item("zzz", "event_ready", "2026-11-10T00:00:00Z")], []);
    expect(feed.events).toEqual([]);
  });

  it("shows only a human-confirmed, upcoming appointment with its zone", () => {
    const confirmed = part({
      id: "a1",
      careCategory: "appointment",
      confirmed: {
        appointment: { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "human_confirmed" },
        respondBy: null,
        taskDue: null,
      },
    });
    const suggestedOnly = part({
      id: "a2",
      suggested: {
        appointment: { at: "2026-11-25T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "model_suggested" },
        respondBy: null,
        taskDue: null,
      },
    });
    const past = part({
      id: "a3",
      confirmed: {
        appointment: { at: "2026-11-01T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "human_confirmed" },
        respondBy: null,
        taskDue: null,
      },
    });
    const ev = event("a", { parts: [suggestedOnly, past, confirmed] });
    expect(feedOf([item("a", "event_ready", "2026-11-10T00:00:00Z")], [ev]).events[0].nextAppointment).toEqual({
      at: "2026-11-27T05:30:00Z",
      timeZone: "Asia/Tokyo",
    });
    const none = event("b", { parts: [suggestedOnly] });
    expect(feedOf([item("b", "event_ready", "2026-11-10T00:00:00Z")], [none]).events[0].nextAppointment).toBeNull();
  });

  it("exposes no free text beyond the chain title of a ready event", () => {
    const secret = "Metformin 500mg for Taro";
    const ev = event("a", {
      title: "Clinic visit",
      parts: [part({ id: "p", title: secret, description: secret, sourceQuote: secret })],
    });
    const feed = feedOf([item("a", "event_ready", "2026-11-10T00:00:00Z")], [ev]);
    expect(JSON.stringify(feed)).not.toContain("Metformin");
  });
});

describe("QA scenario", () => {
  const appointment = part({
    id: "ap",
    careCategory: "appointment",
    riskLevel: "high",
    approvalRequired: true,
    approvalState: "pending",
    owner: null,
    personToAsk: "Misa",
    missingDetails: [
      {
        key: "ap:location:which_clinic",
        kind: "location",
        questionCode: "which_clinic",
        reasonCode: "missing.reason.location",
        source: "derived",
        storedDetailId: null,
        aiQuestion: null,
        personToAsk: "Misa",
        needsDetails: true,
      },
    ],
  });
  const parts = [
    appointment,
    part({ id: "t", careCategory: "transport", owner: { id: "o2", name: "Ken" } }),
    part({ id: "x", owner: { id: "o3", name: "Ken" }, progressStatus: "completed" }),
    part({ id: "y", owner: { id: "o4", name: "Ken" } }),
  ];

  it("counts 4 parts, one awaiting confirmation, appointment needs someone", () => {
    expect(countParts({ parts, householdId: HOUSEHOLD })).toEqual({
      parts: 4,
      needsSomeone: 1,
      awaitingConfirmation: 1,
      done: 1,
    });
    const feed = feedOf([item("qa", "event_ready", "2026-11-10T00:00:00Z")], [event("qa", { parts })]);
    expect(feed.needsSomeone.map((e) => e.noteId)).toEqual(["qa"]);
    expect(feed.events[0].counts.parts).toBe(4);
  });

  it("shows a legacy completed appointment event as Done, not in 'Needs someone'", () => {
    const legacy = part({
      id: "lg",
      careCategory: "appointment",
      progressStatus: "completed",
      owner: null,
      approvalState: "approved",
      approvalRequired: true,
    });
    const feed = feedOf(
      [item("old", "event_ready", "2026-10-01T00:00:00Z")],
      [event("old", { parts: [legacy] })],
    );
    expect(feed.events[0]).toMatchObject({ done: true, needsSomeone: false });
    expect(feed.events[0].counts).toEqual({ parts: 1, needsSomeone: 0, awaitingConfirmation: 0, done: 1 });
    expect(feed.needsSomeone).toEqual([]);
  });
});
