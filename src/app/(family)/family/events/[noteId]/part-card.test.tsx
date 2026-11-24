import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EventViewer, ReceiverOption } from "@/lib/family/event-offers";
import type { EventPart } from "@/lib/family/shared-care-event";
import { createTranslator } from "@/lib/i18n/messages";

import type { EventActions } from "./event-runner";
import { resultText } from "./event-runner";
import { PartCard } from "./part-card";

const HOUSEHOLD = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-11-01T09:00:00.000Z";
const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const MISA = "00000000-0000-4000-8000-0000000000a3";

const none = async () => ({ ok: true as const });
const actions = new Proxy({}, { get: () => none }) as unknown as EventActions;

const members: ReceiverOption[] = [
  { id: ME, name: "Aki", role: "family_member" },
  { id: OTHER, name: "Ben", role: "primary_caregiver" },
  { id: MISA, name: "Misa", role: "family_member" },
];

function viewer(role: EventViewer["role"], memberId = ME): EventViewer {
  return { memberId, householdId: HOUSEHOLD, role };
}

function part(overrides: Partial<EventPart> = {}): EventPart {
  return {
    id: "00000000-0000-4000-8000-0000000000b1",
    title: "Clinic visit",
    description: null,
    careCategory: "appointment",
    riskLevel: "high",
    progressStatus: "in_progress",
    sourceQuote: "Ask Misa about the clinic. Fri, Nov 27, 2026 \u2014 visit at 2:30 pm.",
    confidence: 0.8,
    approvalRequired: true,
    approvalState: "pending",
    planVersion: 1,
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
    missingDetails: [],
    evidence: { required: [], attachedCount: 0, attached: [] },
    ...overrides,
  };
}

function render(p: EventPart, v: EventViewer) {
  return renderToStaticMarkup(
    <PartCard part={p} viewer={v} members={members} language="en" nowIso={NOW} actions={actions} onChanged={() => {}} />,
  ).replaceAll("&#x27;", "'");
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe("PartCard buttons by role", () => {
  it("offers a care recipient no buttons", () => {
    const html = render(part(), viewer("care_recipient"));
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });

  it("lets an ordinary member claim but not approve", () => {
    const html = render(part(), viewer("family_member"));
    expect(html).toContain("I'll do this");
    expect(html).toContain("I'll drive");
    expect(html).toContain("I'll go with them");
    expect(html).not.toContain("Confirm this task");
    expect(html).not.toContain("Don't approve");
  });

  it("lets a primary caregiver confirm or not approve, and says self-approval is recorded", () => {
    const html = render(part(), viewer("primary_caregiver", OTHER));
    expect(html).toContain("Confirm this task");
    expect(html).toContain("Don't approve");
    const owned = render(part({ owner: { id: OTHER, name: "Ben" } }), viewer("primary_caregiver", OTHER));
    expect(owned).toContain("self-approval");
  });

  it("offers Mark as done to the Owner only when the part is confirmed", () => {
    const owner = { id: ME, name: "Aki" };
    const pending = render(part({ owner }), viewer("family_member"));
    expect(pending).not.toContain("Mark as done");
    expect(pending).toContain("cannot be marked as done until it is confirmed");
    const approved = render(part({ owner, approvalState: "approved" }), viewer("family_member"));
    expect(approved).toContain("Mark as done");
    expect(approved).toContain("Report it did not happen");
  });

  it("offers nothing to claim on a household part except the owner role", () => {
    const html = render(part({ careCategory: "household", riskLevel: "low", approvalRequired: false, approvalState: "not_required" }), viewer("family_member"));
    expect(html).toContain("I'll do this");
    expect(html).not.toContain("I'll drive");
  });

  it("shows pending requests addressed to the viewer with Accept, Decline and the expiry", () => {
    const html = render(
      part({
        owner: { id: OTHER, name: "Ben" },
        pendingRequests: [
          {
            id: "00000000-0000-4000-8000-0000000000c1",
            kind: "handover",
            helperRole: "owner",
            from: { id: OTHER, name: "Ben" },
            to: { id: ME, name: "Aki" },
            createdAt: NOW,
            expiresAt: "2026-11-02T09:00:00.000Z",
          },
        ],
      }),
      viewer("family_member"),
    );
    expect(html).toContain("Ben asks you to take over as Owner.");
    expect(html).toContain("Accept");
    expect(html).toContain("Decline");
    expect(html).toContain("Answer by");
  });

  it("offers Hand over to… to a holder, and explains a blocked release", () => {
    const owner = { id: ME, name: "Aki" };
    const soon = new Date(Date.parse(NOW) + 3600_000).toISOString();
    const html = render(
      part({
        owner,
        approvalState: "approved",
        confirmed: { appointment: null, respondBy: null, taskDue: { at: soon, timeZone: "Asia/Tokyo", provenance: "human_confirmed" } },
      }),
      viewer("family_member"),
    );
    expect(html).toContain("Hand over to…");
    expect(html).toContain("you cannot give it up");
    expect(html).not.toContain("Give up my role");
  });
});

describe("labels", () => {
  it("shows Requires confirmation only while approval is pending", () => {
    const v = viewer("family_member");
    expect(render(part({ approvalState: "pending" }), v)).toContain("Requires confirmation");
    expect(render(part({ approvalState: "approved" }), v)).not.toContain("Requires confirmation");
    expect(render(part({ approvalState: "approved" }), v)).toContain("Confirmed");
    expect(render(part({ approvalState: "rejected" }), v)).not.toContain("Requires confirmation");
    expect(render(part({ approvalState: "rejected" }), v)).toContain("Not approved");
    expect(render(part({ approvalState: "not_required", approvalRequired: false }), v)).not.toContain("Requires confirmation");
  });

  it("shows Done and no pending-approval wording for a completed part", () => {
    const html = render(
      part({ progressStatus: "completed", approvalState: "approved", owner: { id: ME, name: "Aki" } }),
      viewer("family_member"),
    );
    expect(html).toContain("Done");
    expect(html).not.toContain("Requires confirmation");
    expect(html).not.toContain("<button");
  });

  it("shows risk in words", () => {
    expect(render(part({ riskLevel: "high" }), viewer("family_member"))).toContain("High risk");
    expect(render(part({ riskLevel: "medium", careCategory: "household", approvalRequired: false, approvalState: "not_required" }), viewer("family_member"))).toContain("Needs attention");
    expect(render(part({ riskLevel: "low", careCategory: "household", approvalRequired: false, approvalState: "not_required" }), viewer("family_member"))).toContain("Low priority");
  });

  it("lets the Owner of a rejected part resubmit with an explanation", () => {
    const html = render(
      part({ approvalState: "rejected", owner: { id: ME, name: "Aki" } }),
      viewer("family_member"),
    );
    expect(html).toContain("Explain what changed");
    expect(html).toContain("Send for confirmation again");
  });
});

describe("times, hints, and missing information", () => {
  it("never shows a model-suggested time as a deadline", () => {
    const html = render(
      part({
        suggested: {
          appointment: null,
          respondBy: null,
          taskDue: { at: "2099-01-01T00:00:00.000Z", timeZone: "UTC", provenance: "model_suggested" },
        },
      }),
      viewer("family_member"),
    );
    expect(html).toContain("Deadline to finish");
    expect(html).not.toContain("2099");
    expect(html).toContain("Not set yet");
    expect(html).toContain("There is no deadline yet");
  });

  it("shows the three times separately with their zone", () => {
    const t = (at: string) => ({ at, timeZone: "Asia/Tokyo", provenance: "human_confirmed" as const });
    const html = render(
      part({
        confirmed: {
          appointment: t("2026-11-27T05:30:00.000Z"),
          respondBy: t("2026-11-20T03:00:00.000Z"),
          taskDue: t("2026-11-26T03:00:00.000Z"),
        },
      }),
      viewer("family_member"),
    );
    expect(html).toContain("Appointment time");
    expect(html).toContain("Reply by");
    expect(html).toContain("Deadline to finish");
    expect(count(html, "Asia/Tokyo time")).toBe(3);
  });

  it("shows Person_To_Ask as a hint with no owner assigned", () => {
    const html = render(part(), viewer("family_member"));
    expect(html).toContain("The note says to ask Misa");
    expect(html).toContain("Owner: Nobody yet");
    expect(html).toContain("Needs someone");
  });

  it("shows the original quote as written, under From the note", () => {
    const html = render(part(), viewer("family_member"));
    expect(html).toContain("From the note");
    expect(html).toContain("Ask Misa about the clinic.");
  });

  it("lists each missing detail with why it is needed, and prefills the appointment form from the quote", () => {
    const html = render(
      part({
        missingDetails: [
          {
            key: "a:which_clinic",
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
      }),
      viewer("family_member"),
    );
    expect(html).toContain("Information still missing");
    expect(html).toContain("Which clinic or hospital is it?");
    expect(html).toContain("Why we ask: Without a place, nobody knows where to go.");
    expect(html).toContain('value="2026-11-27"');
    expect(html).toContain('value="14:30"');
    expect(html).toContain("Date and time filled in from the note");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Save appointment details");
  });

  it("shows no forms to a care recipient", () => {
    const html = render(
      part({
        missingDetails: [
          {
            key: "a:which_clinic",
            kind: "location",
            questionCode: "which_clinic",
            reasonCode: "missing.reason.location",
            source: "derived",
            storedDetailId: null,
            aiQuestion: null,
            personToAsk: null,
            needsDetails: true,
          },
        ],
      }),
      viewer("care_recipient"),
    );
    expect(html).toContain("Which clinic or hospital is it?");
    expect(html).not.toContain("<form");
  });
});

describe("amount and appointment forms", () => {
  const detail = (questionCode: string, kind: string) => ({
    key: `a:${questionCode}`,
    kind,
    questionCode,
    reasonCode: "missing.reason.amount",
    source: "derived" as const,
    storedDetailId: null,
    aiQuestion: null,
    personToAsk: null,
    needsDetails: true,
  });

  it("shows a labelled amount form with a currency choice to a family member, and none to a care recipient", () => {
    const payment = part({ careCategory: "payment", missingDetails: [detail("which_amount", "amount") as never] });
    const html = render(payment, viewer("family_member"));
    expect(html).toContain("How much is needed?");
    expect(html).toContain(">Amount <");
    expect(html).toContain(">Currency<");
    expect(html).toContain('aria-required="true"');
    expect(html).toContain("<option value=\"JPY\"");
    expect(html).toContain("Save amount");
    expect(html).toContain("It does not pay anything.");
    expect(render(payment, viewer("care_recipient"))).not.toContain("<form");
  });

  it("shows no amount form when the question is about something else", () => {
    const html = render(part({ missingDetails: [detail("which_clinic", "location") as never] }), viewer("family_member"));
    expect(html).not.toContain("Save amount");
  });

  it("keeps the appointment form time zone confirmation", async () => {
    const html = render(part({ missingDetails: [detail("which_clinic", "location") as never] }), viewer("family_member"));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Save appointment details");
    expect(html).toContain("Reading this device&#x27;s time zone".replace("&#x27;", "'"));
  });
});

describe("action results", () => {
  it("turns the evidence_required result into a plain message with what is missing", () => {
    const tr = createTranslator("en");
    const msg = resultText(tr, {
      ok: true,
      outcome: "evidence_required",
      messageKey: "outcome.evidenceRequired",
      missing: ["Receipt photo", "Signed form"],
    });
    expect(msg.kind).toBe("status");
    expect(msg.text).toBe("Not marked as done yet. Proof is still needed: Receipt photo and Signed form.");
  });

  it("turns a refusal key into words and never shows an unknown key", () => {
    const tr = createTranslator("en");
    expect(resultText(tr, { ok: false, messageKey: "refusal.alreadyClaimed", params: {} })).toEqual({
      kind: "alert",
      text: "Someone is already responsible for this task.",
    });
    expect(resultText(tr, { ok: false, messageKey: "nonsense.key", params: {} }).text).toBe(
      "Something went wrong. Nothing was changed. Please try again.",
    );
  });
});

describe("PartCard in Japanese", () => {
  it("shows Japanese labels and buttons, and keeps the note text as written", () => {
    const html = renderToStaticMarkup(
      <PartCard
        part={part()}
        viewer={viewer("primary_caregiver", OTHER)}
        members={members}
        language="ja"
        nowIso={NOW}
        actions={actions}
        onChanged={() => {}}
      />,
    );
    expect(html).toContain("高リスク");
    expect(html).toContain("確認が必要");
    expect(html).toContain("私がやります");
    expect(html).toContain("Clinic visit");
    expect(html).toContain("Ask Misa about the clinic.");
    for (const english of ["Requires confirmation", "High risk", "Needs someone", "I'll do this", "Nobody yet", "Confirm this task"]) {
      expect(html.replaceAll("&#x27;", "'")).not.toContain(english);
    }
  });
});
