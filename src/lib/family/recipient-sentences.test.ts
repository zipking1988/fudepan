import { describe, expect, it } from "vitest";
import { recipientSentences, sentencesForPart } from "@/lib/family/recipient-sentences";
import type { EventPart, SharedCareEvent } from "@/lib/family/shared-care-event";
import { createTranslator } from "@/lib/i18n/messages";

const none = { appointment: null, respondBy: null, taskDue: null };

function part(over: Partial<EventPart> = {}): EventPart {
  return {
    id: "p1",
    title: "Clinic visit",
    description: null,
    careCategory: "appointment",
    riskLevel: "high",
    progressStatus: "pending_review",
    sourceQuote: null,
    confidence: 0.9,
    approvalRequired: true,
    approvalState: "not_required",
    planVersion: 1,
    owner: null,
    driver: null,
    companion: null,
    backup: null,
    suggestedRole: null,
    personToAsk: null,
    location: null,
    confirmed: none,
    suggested: none,
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [],
    evidence: { required: [], attachedCount: 0, attached: [] },
    ...over,
  };
}

function event(parts: EventPart[], over: Partial<SharedCareEvent> = {}): SharedCareEvent {
  return {
    noteId: "n1",
    householdId: "h1",
    state: "ready",
    retryable: false,
    failureReason: null,
    chainId: "c1",
    title: null,
    riskLevel: null,
    createdAt: "2026-11-01T00:00:00Z",
    parts,
    done: false,
    ...over,
  };
}

const t = createTranslator("en");
const render = (e: SharedCareEvent) => recipientSentences(e).map((s) => t.t(s.key, s.params));

describe("recipientSentences", () => {
  it("names who is going and who is driving", () => {
    const out = render(
      event([
        part({
          companion: { id: "a", name: "Misa" },
          driver: { id: "b", name: "Kenta" },
          owner: { id: "b", name: "Kenta" },
        }),
      ]),
    );
    expect(out).toContain("Misa is going with you.");
    expect(out).toContain("Kenta is driving.");
    expect(out.filter((s) => s.includes("Kenta"))).toHaveLength(1);
  });

  it("says no one is going when an appointment has no companion", () => {
    expect(render(event([part()]))).toContain("No one is going with you yet.");
  });

  it("states only a human-confirmed appointment time, with its zone", () => {
    const confirmed = {
      ...none,
      appointment: { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "human_confirmed" as const },
    };
    expect(render(event([part({ confirmed })]))).toContain(
      "Your visit is on Fri, November 27, 2026 at 2:30 PM (Asia/Tokyo time).",
    );
  });

  it("never shows a model-suggested time", () => {
    const suggested = {
      ...none,
      appointment: { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "model_suggested" as const },
    };
    const out = render(event([part({ suggested, confirmed: suggested })]));
    expect(out).toContain("The time is not confirmed yet.");
    expect(out.join(" ")).not.toMatch(/2026|2:30/);
  });

  it("shows pending approval as a family check", () => {
    expect(render(event([part({ approvalState: "pending" })]))).toContain("Your family is checking this.");
  });

  it("lists missing details by kind, not by the ai& text", () => {
    const out = render(
      event([
        part({
          personToAsk: "Misa",
          missingDetails: [
            {
              key: "p1:location:which_clinic",
              kind: "location",
              questionCode: "which_clinic",
              reasonCode: "missing.reason.location",
              source: "derived",
              storedDetailId: null,
              aiQuestion: "Is it Dr. Sato at the heart clinic?",
              personToAsk: "Misa",
              needsDetails: true,
            },
            {
              key: "p1:date:ai_question",
              kind: "date",
              questionCode: "ai_question",
              reasonCode: "missing.reason.date",
              source: "stored",
              storedDetailId: "d1",
              aiQuestion: "Maybe next Tuesday?",
              personToAsk: null,
              needsDetails: true,
            },
          ],
        }),
      ]),
    );
    expect(out).toContain("Your family still needs to find out: which clinic.");
    expect(out).toContain("Your family still needs to find out: which date.");
    expect(out.join(" ")).not.toMatch(/Sato|Tuesday|heart/);
  });

  it("says Done for a completed legacy appointment", () => {
    const e = event([part({ progressStatus: "completed", approvalState: "approved" })], { done: true });
    expect(render(e)).toEqual(["Done."]);
  });

  it("handles reading, uploaded, and failed notes", () => {
    expect(render(event([], { state: "reading", chainId: null }))).toEqual(["Your family is reading your note."]);
    expect(render(event([], { state: "uploaded", chainId: null }))).toEqual(["Your family is reading your note."]);
    expect(render(event([], { state: "failed", chainId: null }))).toEqual(["Your family will look at your note."]);
  });

  it("uses a neutral sentence when a helper has no name", () => {
    const out = sentencesForPart(part({ driver: { id: "b", name: " " } }));
    expect(out[0]).toEqual({ key: "recipient.helper.driverUnnamed" });
  });

  it("never shows internal words, evidence, or other people's reminders", () => {
    const out = render(
      event([
        part({
          progressStatus: "escalated",
          approvalState: "pending",
          evidence: { required: ["Receipt"], attachedCount: 1, attached: [{ id: "e", kind: "photo", label: "Receipt" }] },
          hasRequiredAmount: true,
          pendingRequests: [
            {
              id: "r",
              kind: "handover",
              helperRole: null,
              from: { id: "a", name: "Misa" },
              to: { id: "b", name: "Kenta" },
              createdAt: "",
              expiresAt: "",
            },
          ],
        }),
      ]),
    ).join(" ");
    expect(out).not.toMatch(/\b(part|chain|approval_state|escalated|evidence|receipt|reminder)\b/i);
  });

  it("returns keys and params only, with no hardcoded text", () => {
    for (const s of recipientSentences(event([part({ companion: { id: "a", name: "Misa" } })]))) {
      expect(Object.keys(s).every((k) => k === "key" || k === "params")).toBe(true);
      expect(s.key).toMatch(/^recipient\./);
    }
  });
});
