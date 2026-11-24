import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { meRouteDecision } from "@/lib/family/recipient-routing";
import type { EventPart, SharedCareEvent } from "@/lib/family/shared-care-event";
import { HOUSEHOLD_ROLES } from "@/lib/households/membership";
import { assistantMood, firstName, forGrandma, pickComingUp, RecipientEventView, RecipientHomeView } from "./recipient-view";

vi.mock("./actions", () => ({ sendRecipientReply: vi.fn() }));

/** The only buttons Grandma gets are the two fixed replies (Requirement 13.8). */
function buttonLabels(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]*>/g, "").trim());
}

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
  const html = renderToStaticMarkup(<RecipientHomeView events={[event()]} language="en" recipientName="Haruko (Mom)" />);

  it("has one big photo link and only the two fixed reply buttons: no forms, inputs or free text", () => {
    expect(html).toContain('href="/family/capture"');
    expect(html).toContain("Take a photo of a note");
    expect(html).toContain("family-recipient__photo");
    expect(buttonLabels(html)).toEqual(["👍 Thank you", "🙋 I have a question"]);
    expect(html).not.toMatch(/<(form|input|textarea|select)\b/);
  });

  it("greets her by name and speaks as her assistant", () => {
    expect(html).toContain("Hello, Haruko.");
    expect(html).not.toContain("(Mom)");
    expect(html).toContain("I read your note. Your family is taking care of it.");
    expect(html).toContain("Coming up");
  });

  it("shows the visit as a picture card: icon, who goes with her, and no unconfirmed time", () => {
    expect(html).toContain("🏥");
    expect(html).toContain("Clinic visit");
    expect(html).toContain("Going with you");
    expect(html).toContain(">Misa<"); // her companion as a face with a name
    expect(html).toContain("Your family is checking the time");
    expect(html).not.toContain("2030"); // a model-suggested time is never shown to her
    expect(html).toContain(`href="/family/me/${NOTE}"`);
  });

  it("shows a family-confirmed time big, in its own zone", () => {
    const confirmed = renderToStaticMarkup(
      <RecipientHomeView
        events={[event({ parts: [part({ confirmed: { ...noTimes, appointment: { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "human_confirmed" } } })] })]}
        language="en"
      />,
    );
    expect(confirmed).toContain(">14:30<");
    expect(confirmed).toContain("Fri, Nov 27");
    expect(confirmed).not.toContain("Your family is checking the time");
  });

  it("uses large-text classes and no internal words", () => {
    expect(html).toContain("family-recipient");
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(INTERNAL);
  });

  it("shows a finished note as ✅ and a note being read as ⏳, hiding the title until ready", () => {
    const done = renderToStaticMarkup(
      <RecipientHomeView events={[event({ done: true, parts: [part({ progressStatus: "completed" })] })]} language="en" />,
    );
    expect(done).toContain("✅");
    expect(done).not.toContain("which clinic");
    expect(done).toContain("Everything on your notes is done. You can rest.");
    expect(buttonLabels(done)).toEqual([]); // nothing coming up, so nothing to reply to here
    const reading = renderToStaticMarkup(
      <RecipientHomeView events={[event({ state: "reading", title: "Secret title", parts: [] })]} language="en" />,
    );
    expect(reading).not.toContain("Secret title");
    expect(reading).toContain("⏳");
    expect(reading).toContain("I'm reading your note now.".replace("'", "&#x27;"));
  });

  it("invites a first photo when there are no notes", () => {
    const empty = renderToStaticMarkup(<RecipientHomeView events={[]} language="en" />);
    expect(empty).toContain("Hello.");
    expect(empty).toContain("When you write a note, take a photo of it.");
    expect(empty).toContain('href="/family/capture"');
  });
});

describe("RecipientEventView", () => {
  const html = renderToStaticMarkup(<RecipientEventView event={event()} language="en" />);
  const text = html.replace(/<[^>]*>/g, " ");

  it("shows the picture card, a photo with alt text, a back link, the photo action and the two replies", () => {
    expect(html).toContain("Your family is checking the time");
    expect(html).toContain("Going with you");
    expect(html).toContain(`src="/notes/${NOTE}/image"`);
    expect(html).toContain('alt="The photo of your note, as you sent it"');
    expect(html).toContain('href="/family"');
    expect(html).toContain('href="/family/capture"');
    expect(buttonLabels(html)).toEqual(["👍 Thank you", "🙋 I have a question"]);
    expect(html).not.toMatch(/<(form|input|textarea|select)\b/);
    expect(html).not.toContain("/timeline");
  });

  it("shows the screenshot card: name, orange date/time block, faces, read and note buttons", () => {
    const ja = renderToStaticMarkup(
      <RecipientEventView
        event={event({ parts: [part({ confirmed: { ...noTimes, appointment: { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "human_confirmed" } } })] })}
        language="ja"
        recipientName="春子（母）"
      />,
    );
    expect(ja).toMatch(/<h1[^>]*>春子さん<\/h1>/);
    expect(ja).toContain("11月27日（金）");
    expect(ja).toContain(">14:30<");
    expect(ja).toContain("いっしょに行く人");
    expect(ja).toContain(">メモ<");
    expect(ja).toContain('href="/family/capture"');
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

describe("Grandma's assistant helpers", () => {
  it("drops the family's note in brackets from her name", () => {
    expect(firstName("Haruko (Mom)")).toBe("Haruko");
    expect(firstName("春子（母）")).toBe("春子");
    expect(firstName(null)).toBe("");
  });

  it("puts the open note with the soonest confirmed time first", () => {
    const at = (iso: string) => ({ ...noTimes, appointment: { at: iso, timeZone: "Asia/Tokyo", provenance: "human_confirmed" as const } });
    const later = event({ noteId: "n-later", parts: [part({ confirmed: at("2030-02-01T01:00:00Z") })] });
    const sooner = event({ noteId: "n-sooner", parts: [part({ confirmed: at("2030-01-05T01:00:00Z") })] });
    const done = event({ noteId: "n-done", done: true });
    expect(pickComingUp([later, done, sooner])?.noteId).toBe("n-sooner");
    expect(pickComingUp([done])).toBeNull();
  });

  it("keeps the card calm: no repeated lines and no family-only details", () => {
    const lines = forGrandma([
      { key: "recipient.missing.which_clinic" },
      { key: "recipient.checking" },
      { key: "recipient.missing.which_clinic" },
      { key: "recipient.missing.when_is_deadline" },
      { key: "recipient.missing.which_person" },
      { key: "recipient.checking" },
      { key: "recipient.helper.driver", params: { name: "Kenta" } },
    ]);
    expect(lines.map((l) => l.key)).toEqual([
      "recipient.missing.which_clinic",
      "recipient.checking",
      "recipient.helper.driver",
    ]);
  });

  it("knows what to say for each situation", () => {
    expect(assistantMood([])).toBe("nothingYet");
    expect(assistantMood([event({ state: "reading", parts: [] })])).toBe("reading");
    expect(assistantMood([event()])).toBe("onIt");
    expect(assistantMood([event({ done: true })])).toBe("allDone");
  });

  it("speaks polite Japanese, with her name as written", () => {
    const ja = renderToStaticMarkup(<RecipientHomeView events={[event()]} language="ja" recipientName="春子" />);
    expect(ja).toContain("春子さん、こんにちは。");
    expect(ja).toContain("メモを読みました。ご家族が対応しています。");
    expect(ja).toContain("次の予定");
    expect(ja).toContain("ありがとう");
    expect(ja).toContain("聞きたいことがあります");
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
