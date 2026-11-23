import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "@/lib/care/timeline";
import type { EventViewer, ReceiverOption } from "@/lib/family/event-offers";
import type { EventPart, MissingDetailView, SharedCareEvent } from "@/lib/family/shared-care-event";
import type { EventActions } from "./event-runner";
import { ThreadView } from "./thread-view";

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

const clinic = {
  key: "visit:which_clinic",
  kind: "location",
  questionCode: "which_clinic",
  reasonCode: "missing.reason.location",
  source: "derived",
  storedDetailId: null,
  aiQuestion: null,
  personToAsk: "Misa",
} as MissingDetailView;

function part(overrides: Partial<EventPart> = {}): EventPart {
  return {
    id: "00000000-0000-4000-8000-0000000000b1",
    title: "Attend clinic visit",
    description: null,
    careCategory: "appointment",
    riskLevel: "high",
    progressStatus: "pending_review",
    sourceQuote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
    confidence: 0.9,
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
    confirmed: { appointment: null, respondBy: null, taskDue: null },
    suggested: { appointment: null, respondBy: null, taskDue: null },
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [clinic],
    evidence: { required: [], attachedCount: 0, attached: [] },
    ...overrides,
  };
}

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

const timeline: TimelineEntry[] = [
  { id: "e1", type: "note.uploaded", labelKey: "timeline.note_uploaded", params: {}, at: "2026-11-23T11:50:24Z", actorName: "Haruko", actorType: "human", stepTitle: null },
  { id: "e3", type: "extraction_succeeded", labelKey: "timeline.extraction_succeeded", params: {}, at: "2026-11-23T11:50:57Z", actorName: null, actorType: "ai", stepTitle: null },
  { id: "e5", type: "part.driver_volunteered", labelKey: "timeline.part_driver_volunteered", params: { role: "driver" }, at: "2026-11-23T12:04:00Z", actorName: "Kenta", actorType: "human", stepTitle: "Attend clinic visit" },
];

function render(ev: SharedCareEvent, role: EventViewer["role"] = "family_member", lang: "en" | "ja" = "en", memberId = ME) {
  return renderToStaticMarkup(
    <ThreadView
      event={ev}
      timeline={timeline}
      viewerName={members.find((m) => m.id === memberId)?.name ?? null}
      viewer={{ memberId, householdId: HOUSEHOLD, role }}
      members={members}
      language={lang}
      nowIso="2026-11-23T12:10:00Z"
      actions={actions}
      onChanged={() => {}}
    />,
  ).replaceAll("&#x27;", "'");
}

describe("ThreadView", () => {
  it("reads as a conversation: photo, Fudepan's summary, one question, the task card", () => {
    const html = render(event([part()]));
    expect(html).toContain('aria-label="Conversation about this note"');
    expect(html).toContain('alt="Photo of the handwritten note"');
    expect(html).toContain("Things to do: 1. Details the note does not say: 1."); // fixed sentence with counts
    expect(html).toContain("Which clinic or hospital is it?");
    expect(html).toContain("The note says to ask Misa. This is only a hint.");
    expect(html).toContain("This is the last open question.");
    expect(html).toContain("Attend clinic visit");
    expect(html).toContain("Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.");
  });

  it("offers one-tap claims and quick replies to a family member, but never approval", () => {
    const html = render(event([part()]));
    expect(html).toContain("I'll do this");
    expect(html).toContain("I'll drive");
    expect(html).toContain('aria-label="Quick replies"');
    expect(html).toContain("I'll go along");
    expect(html).toContain("Answer the question");
    expect(html).toContain("Nothing is booked, paid or sent outside the family.");
    // The quick claim buttons in the card; approval only lives inside "More options" for primaries.
    expect(html).not.toContain("Confirm this task");
  });

  it("shows the viewer's own action as their message", () => {
    const html = render(event([part({ driver: { id: ME, name: "Kenta" } })]));
    expect(html).toContain(">You · <");
  });

  it("keeps Requires confirmation only while approval is pending", () => {
    expect(render(event([part()]))).toContain("Requires confirmation");
    const approved = render(event([part({ approvalState: "approved", owner: { id: ME, name: "Kenta" } })]));
    expect(approved).not.toContain("Requires confirmation");
    expect(approved).toContain("Confirmed");
    const done = render(
      event([part({ approvalState: "approved", progressStatus: "completed", missingDetails: [] })], { done: true }),
    );
    expect(done).not.toContain("Requires confirmation");
    expect(done).toContain("Everything is done.");
    expect(done).not.toContain('aria-label="Quick replies"');
  });

  it("gives a care recipient no buttons or forms", () => {
    const html = render(event([part()]), "care_recipient");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });

  it("while reading, shows the photo and a status message only", () => {
    const html = render(event([], { state: "reading", chainId: null }));
    expect(html).toContain("I'm reading the note now. It usually takes under a minute.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain('aria-label="Quick replies"');
  });

  it("renders in Japanese", () => {
    const html = render(event([part()]), "family_member", "ja");
    expect(html).toContain("このメモについての会話");
    expect(html).toContain("やることが1件見つかりました");
    expect(html).toContain("タップだけで使えます");
    expect(html).not.toContain("Quick replies");
  });
});
