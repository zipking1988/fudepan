import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { meRouteDecision } from "@/lib/family/recipient-routing";
import type { EventPart, SharedCareEvent } from "@/lib/family/shared-care-event";
import { HOUSEHOLD_ROLES } from "@/lib/households/membership";
import { RecipientEventView, RecipientHomeView } from "./recipient-view";

const NOTE = "11111111-1111-4111-8111-111111111111";
const noTimes = { appointment: null, respondBy: null, taskDue: null };

function part(over: Partial<EventPart> = {}): EventPart {
  return {
    id: "p1",
    title: "Visit the clinic",
    description: null,
    careCategory: "appointment",
    riskLevel: "medium",
    progressStatus: "open",
    sourceQuote: null,
    confidence: 0.4,
    approvalRequired: false,
    approvalState: "not_required",
    planVersion: 1,
    owner: null,
    driver: null,
    companion: { id: "m1", name: "Misa" },
    backup: null,
    suggestedRole: null,
    personToAsk: null,
    location: null,
    confirmed: noTimes,
    suggested: { ...noTimes, appointment: { at: "2030-01-01T09:00:00Z", timeZone: "Asia/Tokyo", provenance: "model_suggested" } },
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [
      { kind: "location", questionCode: "which_clinic", questionText: "Which clinic?", reason: "x", resolved: false },
    ] as unknown as EventPart["missingDetails"],
    evidence: { required: ["receipt"], attachedCount: 0, attached: [] },
    ...over,
  } as EventPart;
}

function event(over: Partial<SharedCareEvent> = {}): SharedCareEvent {
  return {
    noteId: NOTE,
    householdId: "h1",
    state: "ready",
    retryable: false,
    failureReason: null,
    chainId: "c1",
    title: "Clinic visit",
    riskLevel: "medium",
    createdAt: "2030-01-01T00:00:00Z",
    parts: [part()],
    done: false,
    ...over,
  };
}

const INTERNAL = /\b(part|chain|approval|escalated|confidence)\b/i;

describe("RecipientHomeView", () => {
  const html = renderToStaticMarkup(<RecipientHomeView events={[event()]} language="en" />);

  it("has one big photo link and no buttons, forms or inputs", () => {
    expect(html).toContain('href="/family/capture"');
    expect(html).toContain("Take a photo of a note");
    expect(html).toContain("family-recipient__photo");
    expect(html).not.toMatch(/<(button|form|input|textarea|select)\b/);
  });

  it("shows plain sentences for the clinic visit and links to the detail page", () => {
    expect(html).toContain("Clinic visit");
    expect(html).toContain("Misa is going with you.");
    expect(html).toContain("The time is not confirmed yet.");
    expect(html).toContain("Your family still needs to find out: which clinic.");
    expect(html).not.toContain("2030");
    expect(html).toContain(`href="/family/me/${NOTE}"`);
  });

  it("uses large-text classes and no internal words", () => {
    expect(html).toContain("family-recipient");
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(INTERNAL);
  });

  it("shows only 'Done.' for a completed event and hides the title until ready", () => {
    const done = renderToStaticMarkup(
      <RecipientHomeView events={[event({ done: true, parts: [part({ progressStatus: "completed" })] })]} language="en" />,
    );
    expect(done).toContain("Done.");
    expect(done).not.toContain("which clinic");
    const reading = renderToStaticMarkup(
      <RecipientHomeView events={[event({ state: "reading", title: "Secret title", parts: [] })]} language="en" />,
    );
    expect(reading).not.toContain("Secret title");
    expect(reading).toContain("Your family is reading your note.");
  });

  it("says so when there are no notes", () => {
    expect(renderToStaticMarkup(<RecipientHomeView events={[]} language="en" />)).toContain("No notes yet.");
  });
});

describe("RecipientEventView", () => {
  const html = renderToStaticMarkup(<RecipientEventView event={event()} language="en" />);
  const text = html.replace(/<[^>]*>/g, " ");

  it("has sentences, a photo with alt text, a back link and only the photo action", () => {
    expect(html).toContain("The time is not confirmed yet.");
    expect(html).toContain("which clinic");
    expect(html).toContain(`src="/notes/${NOTE}/image"`);
    expect(html).toContain('alt="The photo of your note, as you sent it"');
    expect(html).toContain('href="/family"');
    expect(html).toContain('href="/family/capture"');
    expect(html).not.toMatch(/<(button|form|input|textarea|select)\b/);
    expect(html).not.toContain("/timeline");
  });

  it("leaves out evidence, amounts, reminders and internal words", () => {
    expect(text).not.toMatch(INTERNAL);
    expect(text).not.toMatch(/receipt|evidence|reminder|claim|approve/i);
  });

  it("shows only 'Done.' for a completed event", () => {
    const done = renderToStaticMarkup(
      <RecipientEventView event={event({ done: true, parts: [part({ progressStatus: "completed" })] })} language="en" />,
    );
    expect(done).toContain("Done.");
    expect(done).not.toContain("Visit the clinic");
  });
});

describe("meRouteDecision", () => {
  it("keeps the care recipient and redirects every other role to the event page", () => {
    for (const role of HOUSEHOLD_ROLES) {
      expect(meRouteDecision(role, NOTE)).toEqual(
        role === "care_recipient" ? { kind: "stay" } : { kind: "redirect", to: `/family/events/${NOTE}` },
      );
    }
  });
});
