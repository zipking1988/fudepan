import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventViewer, ReceiverOption } from "@/lib/family/event-offers";
import type { EventPart, SharedCareEvent } from "@/lib/family/shared-care-event";
import type { EventActions } from "./event-runner";
import { EventCardView } from "./event-card-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const ME = "00000000-0000-4000-8000-0000000000a1";
const PRIMARY = "00000000-0000-4000-8000-0000000000a2";
const none = async () => ({ ok: true as const });
const actions = new Proxy({}, { get: () => none }) as unknown as EventActions;
const members: ReceiverOption[] = [
  { id: ME, name: "Kenta", role: "family_member" },
  { id: PRIMARY, name: "Misa", role: "primary_caregiver" },
];
const noTimes = { appointment: null, respondBy: null, taskDue: null };

function part(overrides: Partial<EventPart> = {}): EventPart {
  return {
    id: "00000000-0000-4000-8000-0000000000b1",
    title: "Attend clinic visit at 2:30 pm",
    description: "A long description written by the model that should not be on the card.",
    careCategory: "appointment",
    riskLevel: "high",
    progressStatus: "pending_review",
    sourceQuote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
    confidence: 0.95,
    approvalRequired: true,
    approvalState: "pending",
    planVersion: 0,
    owner: null,
    driver: null,
    companion: null,
    backup: null,
    suggestedRole: null,
    personToAsk: "Misa",
    location: null,
    confirmed: noTimes,
    suggested: noTimes,
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [],
    evidence: { required: [], attachedCount: 0, attached: [] },
    ...overrides,
  };
}

const insurance = part({
  id: "00000000-0000-4000-8000-0000000000b2",
  title: "Bring insurance card",
  careCategory: "document",
  riskLevel: "medium",
  sourceQuote: "Bring my insurance card.",
  personToAsk: null,
});

function event(parts: EventPart[], overrides: Partial<SharedCareEvent> = {}): SharedCareEvent {
  return {
    noteId: "00000000-0000-4000-8000-0000000000n1",
    householdId: HOUSEHOLD,
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

function render(ev: SharedCareEvent, role: EventViewer["role"] = "family_member", language: "en" | "ja" = "en", memberId = ME) {
  return renderToStaticMarkup(
    <EventCardView
      event={ev}
      timeline={[]}
      viewerName={members.find((m) => m.id === memberId)?.name ?? null}
      recipientName="Haruko (Mom)"
      viewer={{ memberId, householdId: HOUSEHOLD, role }}
      members={members}
      language={language}
      nowIso="2026-11-23T12:10:00Z"
      actions={actions}
      onChanged={() => {}}
    />,
  ).replaceAll("&#x27;", "'");
}

/** Text a person reads on the card itself, before opening "More details". */
function cardText(html: string): string {
  return html.split("<details")[0].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

describe("EventCardView", () => {
  it("says what, when and where in a glance, with the note's time marked for checking", () => {
    const html = render(event([part(), insurance]));
    expect(html).toContain("🏥");
    expect(html).toContain("Clinic visit");
    expect(html).toContain(">27<");
    expect(html).toContain(" 14:30");
    expect(html).toContain("From the note. Please check.");
    expect(html).toContain("Which clinic?");
    expect(html).toContain("Ask Misa");
  });

  it("is short: the card itself has few words and no internal details", () => {
    const text = cardText(render(event([part(), insurance])));
    expect(text.split(" ").length).toBeLessThan(90);
    expect(text).not.toMatch(/Confidence|Category|overdue|Draft|step/i);
    expect(text).not.toContain("A long description written by the model");
  });

  it("shows empty seats as faces and offers one-tap buttons for them", () => {
    const html = render(event([part(), insurance]));
    expect(html).toContain("No driver");
    expect(html).toContain("Nobody going along");
    expect(html).toContain("Requires confirmation");
    expect(html).toContain("I'll drive");
    expect(html).toContain("I'll go along");
    expect(html).toContain("I know the clinic");
    expect(html).not.toContain("OK, confirmed"); // only a primary caregiver confirms
  });

  it("shows who is helping by their face and the viewer as You", () => {
    const html = render(event([part({ driver: { id: ME, name: "Kenta" }, companion: { id: PRIMARY, name: "Misa" } }), insurance]));
    expect(html).toContain(">You<");
    expect(html).toContain(">Misa<");
    expect(html).not.toContain("No driver");
  });

  it("lets a primary caregiver confirm with one tap", () => {
    expect(render(event([part(), insurance]), "primary_caregiver", "en", PRIMARY)).toContain("OK, confirmed");
  });

  it("gives the care recipient no buttons on the card", () => {
    const html = render(event([part(), insurance]), "care_recipient");
    expect(html.split("<details")[0]).not.toContain("<button");
  });

  it("shows the other things as tiles with an icon and who has them", () => {
    const html = render(event([part(), insurance]));
    expect(html).toContain("🪪");
    expect(html).toContain("Bring insurance card");
    expect(html).toContain("Nobody yet");
    expect(html).toContain("I'll do it");
  });

  it("shows progress as four steps, with the current one marked", () => {
    const html = render(event([part(), insurance]));
    expect(html).toContain('aria-label="Progress"');
    expect(html).toMatch(/aria-current="step"[^>]*>.*?People/);
  });

  it("keeps everything else under More details", () => {
    const html = render(event([part(), insurance]));
    expect(html).toContain("<details");
    expect(html).toContain("More details");
  });

  it("while reading, says so and shows the first step", () => {
    const html = render(event([], { state: "reading" }));
    expect(html).toContain("Reading the note…");
  });

  it("keeps a completed visit in the main slot and shows Done instead of an open time question", () => {
    const done = part({ progressStatus: "completed", approvalState: "approved" });
    const html = render(event([done, insurance], { done: false }), "family_member", "ja");
    const text = cardText(html);
    expect(text).toContain("完了");
    expect(text).not.toContain("時間はまだ分かりません");
    expect(text).not.toContain("日付はまだ分かりません");
  });

  it("works in Japanese", () => {
    const html = render(event([part(), insurance]), "family_member", "ja");
    expect(html).toContain("通院");
    expect(html).toContain("運転します");
    expect(html).toContain("付き添います");
    expect(html).toContain("Misaさんに聞く");
    expect(html).toContain("くわしく見る");
  });
});
