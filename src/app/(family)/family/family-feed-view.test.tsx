import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FamilyFeed, FeedEvent, FeedReminder } from "@/lib/family/feed";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("./actions", () => ({ markFeedSeen: async () => ({ ok: true }), retryRecognition: async () => ({ ok: true }) }));

import { FamilyFeedView } from "./family-feed-view";

const N1 = "11111111-1111-4111-8111-111111111111";
const N2 = "22222222-2222-4222-8222-222222222222";
const N3 = "33333333-3333-4333-8333-333333333333";
const N4 = "44444444-4444-4444-8444-444444444444";

function event(over: Partial<FeedEvent> & { noteId: string }): FeedEvent {
  return {
    chainId: null,
    state: "ready",
    title: "Clinic visit",
    titleKey: null,
    retry: false,
    counts: { parts: 2, needsSomeone: 0, awaitingConfirmation: 0, done: 0 },
    done: false,
    needsSomeone: false,
    nextAppointment: null,
    latestActivityAt: "2026-01-01T00:00:00Z",
    latestKind: "event_ready",
    unseen: false,
    ...over,
  };
}

function feed(events: FeedEvent[], reminders: FeedReminder[] = []): FamilyFeed {
  const needsSomeone = events.filter((e) => e.needsSomeone);
  return {
    events: [...needsSomeone, ...events.filter((e) => !e.needsSomeone)],
    needsSomeone,
    other: events.filter((e) => !e.needsSomeone),
    reminders,
    unseenReminderCount: reminders.filter((r) => !r.seen).length,
    newCount: events.filter((e) => e.unseen).length,
  };
}

function render(f: FamilyFeed) {
  return renderToStaticMarkup(
    <FamilyFeedView feed={f} language="en" householdId="h1" memberName="Aiko" />,
  );
}

describe("FamilyFeedView", () => {
  it("puts Needs someone first, with counts in words and the photo action on top", () => {
    const html = render(
      feed([
        event({ noteId: N1, title: "Other note" }),
        event({
          noteId: N2,
          title: "Pharmacy errand",
          needsSomeone: true,
          counts: { parts: 3, needsSomeone: 2, awaitingConfirmation: 1, done: 0 },
        }),
      ]),
    );
    expect(html.indexOf('href="/family/capture"')).toBeGreaterThan(-1);
    expect(html.indexOf('href="/family/capture"')).toBeLessThan(html.indexOf("Needs someone"));
    expect(html.indexOf("Needs someone")).toBeLessThan(html.indexOf("Latest updates"));
    expect(html.indexOf("Pharmacy errand")).toBeLessThan(html.indexOf("Other note"));
    expect(html).toContain("2 parts need someone");
    expect(html).toContain("1 waiting for confirmation");
    expect(html).toContain(`href="/family/events/${N2}"`);
    expect(html).toContain('aria-labelledby="feed-event-' + N2 + '"');
  });

  it("shows Being read with a polite status", () => {
    const html = render(
      feed([event({ noteId: N1, state: "reading", title: null, titleKey: "feed.heading.beingRead" })]),
    );
    expect(html).toContain("Being read");
    expect(html).toMatch(/role="status" aria-live="polite"[^>]*>We are reading this note/);
  });

  it("shows retry and view-original for a failed event", () => {
    const html = render(
      feed([
        event({ noteId: N3, state: "failed", title: null, titleKey: "feed.couldNotRead", retry: true }),
        event({ noteId: N1 }),
      ]),
    );
    expect(html).toContain("Could not read this note");
    expect(html.match(/Try again/g)).toHaveLength(1);
    expect(html).toContain(`href="/notes/${N3}/image"`);
    expect(html).toContain("View original note");
  });

  it("marks unseen events with the text New and announces the count", () => {
    const html = render(feed([event({ noteId: N1, unseen: true }), event({ noteId: N2 })]));
    expect(html).toContain(">New<");
    expect(html.match(/>New</g)).toHaveLength(1);
    expect(html).toContain("1 new update");
    expect(html).toContain("Mark all as seen");
  });

  it("shows Done for a finished event and never Requires confirmation", () => {
    const html = render(
      feed([
        event({
          noteId: N4,
          done: true,
          counts: { parts: 1, needsSomeone: 0, awaitingConfirmation: 0, done: 1 },
        }),
      ]),
    );
    expect(html).toContain("Done");
    expect(html).not.toContain("Requires confirmation");
    expect(html).not.toContain("waiting for confirmation");
  });

  it("writes out the zone of the next appointment", () => {
    const html = render(
      feed([event({ noteId: N1, nextAppointment: { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo" } })]),
    );
    expect(html).toContain("Next appointment:");
    expect(html).toContain("Asia/Tokyo time");
  });

  it("lists reminders in words with a link, and no reminder section when there are none", () => {
    const reminders: FeedReminder[] = [
      { id: "r1", noteId: N1, careChainId: null, kind: "x", createdAt: "2026-01-01T00:00:00Z", seen: false },
    ];
    const html = render(feed([event({ noteId: N1 })], reminders));
    expect(html).toContain("Aiko has an in-app reminder");
    expect(html).toContain("Your reminders");
    expect(html).toContain(`href="/family/events/${N1}"`);
    expect(render(feed([event({ noteId: N1 })]))).not.toContain("in-app reminder");
  });

  it("shows an empty state with a single h1 and no raw ids or scores", () => {
    const html = render(feed([]));
    expect(html).toContain("Nothing here yet.");
    expect(html.match(/<h1/g)).toHaveLength(1);
    const full = render(feed([event({ noteId: N1 })]));
    expect(full).not.toMatch(/confidence|household_id/i);
  });
});

describe("FamilyFeedView in Japanese", () => {
  it("shows Japanese words and none of the English interface words", () => {
    const html = renderToStaticMarkup(
      <FamilyFeedView
        feed={feed([
          event({
            noteId: N2,
            title: "Pharmacy errand",
            needsSomeone: true,
            counts: { parts: 3, needsSomeone: 2, awaitingConfirmation: 1, done: 0 },
          }),
          event({ noteId: N1, state: "reading", title: null, titleKey: "feed.heading.beingRead" }),
        ])}
        language="ja"
        householdId="h1"
        memberName="Aiko"
      />,
    );
    expect(html).toContain("担当する人が必要です");
    expect(html).toContain("AIが読み取り中");
    expect(html).toContain("担当する人が必要なやることが2件あります");
    expect(html).toContain("確認待ちが1件あります");
    expect(html).toContain("Pharmacy errand");
    for (const english of ["Needs someone", "Being read", "Latest updates", "Requires confirmation", "waiting for confirmation"]) {
      expect(html).not.toContain(english);
    }
  });
});
