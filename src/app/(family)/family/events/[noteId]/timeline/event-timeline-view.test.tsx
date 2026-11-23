import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { TimelineEntry } from "@/lib/care/timeline";

import { EventTimelineView } from "./event-timeline-view";

function entry(over: Partial<TimelineEntry> & Pick<TimelineEntry, "id" | "type" | "labelKey">): TimelineEntry {
  return {
    params: {},
    at: "2026-03-01T10:00:00.000Z",
    actorName: null,
    actorType: "system",
    stepTitle: null,
    ...over,
  };
}

const render = (entries: TimelineEntry[]) =>
  renderToStaticMarkup(<EventTimelineView entries={entries} language="en" eventHref="/family/events/n1" />);

const SEQUENCE: TimelineEntry[] = [
  entry({ id: "1", type: "note.uploaded", labelKey: "timeline.note_uploaded", actorType: "human", actorName: "Aiko" }),
  entry({ id: "2", type: "extraction_started", labelKey: "timeline.extraction_started", actorType: "ai" }),
  entry({ id: "3", type: "extraction_succeeded", labelKey: "timeline.extraction_succeeded", actorType: "ai" }),
  entry({ id: "4", type: "part.claimed", labelKey: "timeline.part_claimed", actorType: "human", actorName: "Ben", stepTitle: "Drive to clinic" }),
  entry({ id: "5", type: "handover.requested", labelKey: "timeline.handover_requested", actorType: "human", actorName: "Ben" }),
  entry({ id: "6", type: "handover.accepted", labelKey: "timeline.handover_accepted", actorType: "human", actorName: "Chie" }),
  entry({ id: "7", type: "approval.given", labelKey: "timeline.approval_given", actorType: "human", actorName: "Aiko" }),
  entry({ id: "8", type: "part.completed", labelKey: "timeline.part_completed", actorType: "human", actorName: "Chie" }),
];

describe("EventTimelineView", () => {
  it("renders the whole sequence in the given order with labels and actors", () => {
    const html = render(SEQUENCE);
    const labels = [
      "Note uploaded",
      "Fudepan started reading the note",
      "Fudepan finished reading the note",
      "Someone took this part",
      "A handover was requested",
      "The handover was accepted",
      "Confirmed by a household member",
      "This part was marked done",
    ];
    const positions = labels.map((l) => html.indexOf(l));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain("Ben");
    expect(html).toContain("Chie");
    expect(html).toContain("For: Drive to clinic");
  });

  it("shows early events before any chain exists, and a labelled ordered list", () => {
    const html = render(SEQUENCE.slice(0, 2));
    expect(html).toContain('<ol aria-label="Events for this note, oldest first"');
    expect((html.match(/<li/g) ?? []).length).toBe(2);
    expect(html).toContain("Fudepan");
    expect(html).toContain('href="/family/events/n1"');
    expect(html).toContain("Back to the event");
  });

  it("labels self-approval in text", () => {
    const html = render([
      entry({ id: "s", type: "approval.given", labelKey: "timeline.approval_self", actorType: "human", actorName: "Ben" }),
    ]);
    expect(html).toContain("Self-approval");
  });

  it("falls back neutrally for unknown types and unnamed members", () => {
    const html = render([
      entry({ id: "u", type: "weird.thing", labelKey: "timeline.not_a_key", actorType: "human", actorName: null }),
    ]);
    expect(html).toContain("Something changed");
    expect(html).toContain("A household member");
    expect(html).not.toContain("weird.thing");
  });

  it("renders params only through the dictionary and leaks no raw payload", () => {
    const html = render([
      entry({
        id: "p",
        type: "assignment.requested",
        labelKey: "timeline.assignment_requested",
        params: { role: "driver", timezone: "Asia/Tokyo", reason_code: "secret_token", missing_count: 2 },
      }),
    ]);
    expect(html).toContain("Role: Driver");
    expect(html).toContain("Time zone: Asia/Tokyo");
    expect(html).toContain("Count: 2");
    expect(html).not.toContain("secret_token");
  });

  it("shows an empty message when there are no events", () => {
    expect(render([])).toContain("Nothing has happened yet.");
  });
});
