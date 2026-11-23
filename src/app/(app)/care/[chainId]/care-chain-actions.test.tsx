import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CareStepDetail } from "@/lib/care/queries";
import { CareChainActions } from "./care-chain-actions";

vi.mock("../actions", () => ({
  addTextEvidence: vi.fn(),
  approveStep: vi.fn(),
  assignStepOwner: vi.fn(),
  completeStep: vi.fn(),
  saveAppointmentClarification: vi.fn(),
}));

/** The Alpha QA appointment step as the query layer returns it. Fake data. */
const STEP: CareStepDetail = {
  id: "73e743bb-d117-4dbf-8921-f1acdfb76b74",
  title: "Attend clinic visit",
  description: null,
  careCategory: "appointment",
  riskLevel: "high",
  status: "pending_review",
  ownerId: null,
  ownerName: null,
  backupOwnerId: null,
  backupOwnerName: null,
  dueAt: null,
  escalationAt: null,
  evidenceRequired: [],
  approvalRequired: true,
  approvalState: null,
  sourceQuote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
  confidence: 0.9,
  appointmentLocation: null,
  appointmentTime: null,
  appointmentTimezone: null,
};

function valueOf(html: string, field: "location" | "date" | "time"): string | undefined {
  return new RegExp(`<input id="appt-${field}-${STEP.id}"[^>]*value="([^"]*)"`).exec(html)?.[1];
}

const render = (step: CareStepDetail) => renderToStaticMarkup(<CareChainActions step={step} members={[]} />);

describe("Missing appointment information form", () => {
  it("prefills the date and time from the note and asks for time-zone confirmation", () => {
    const html = render(STEP);
    expect(valueOf(html, "date")).toBe("2026-11-27");
    expect(valueOf(html, "time")).toBe("14:30");
    expect(valueOf(html, "location")).toBe(""); // clinic still to be entered
    expect(html).toContain("Needs attention: date and time filled in from the note.");
    expect(html).toContain("The note does not say which time zone.");
    // Unchecked by default; disabled until the device zone is known (server render).
    const checkbox = /<input type="checkbox"[^>]*>/.exec(html)?.[0] ?? "";
    expect(checkbox).toContain("disabled");
    expect(checkbox).not.toMatch(/checked=""/);
    // Approval gate is still offered, not bypassed.
    expect(html).toContain("Confirm this step");
    expect(html).not.toContain("Mark as done");
  });

  it("leaves date and time empty and unconfirmed when the note has no exact time", () => {
    const html = render({ ...STEP, sourceQuote: "Clinic next Friday afternoon. Ask Misa which clinic." });
    expect(valueOf(html, "date")).toBe("");
    expect(valueOf(html, "time")).toBe("");
    expect(html).not.toContain("filled in from the note");
    expect(html).not.toContain('type="checkbox"');
  });
});

describe("approval buttons by state", () => {
  it("completed high-risk step: no Confirm button, no approval hint, no Mark as done", () => {
    const html = render({ ...STEP, status: "completed", appointmentLocation: "Fake Clinic", appointmentTime: "2026-11-27T05:30:00Z", appointmentTimezone: "Asia/Tokyo" });
    expect(html).not.toContain("Confirm this step");
    expect(html).not.toContain("taking personal responsibility");
    expect(html).not.toContain("Mark as done");
  });

  it("approved high-risk step: offers Mark as done, not Confirm", () => {
    const html = render({ ...STEP, status: "approved" });
    expect(html).toContain("Mark as done");
    expect(html).not.toContain("Confirm this step");
  });

  it.each(["pending_review", "in_progress", "evidence_required", "escalated"])(
    "stored approved with progress status %s: Mark as done and evidence box, no Confirm",
    (status) => {
      const html = render({ ...STEP, status, approvalState: "approved" });
      expect(html).toContain("Mark as done");
      expect(html).toContain("Add evidence");
      expect(html).not.toContain("Confirm this step");
    },
  );

  it.each(["pending_review", "in_progress"])("stored pending (%s): Confirm, no Mark as done", (status) => {
    const html = render({ ...STEP, status, approvalState: "pending" });
    expect(html).toContain("Confirm this step");
    expect(html).not.toContain("Mark as done");
    expect(html).not.toContain("Add evidence");
  });

  it("stored rejected: neither Confirm nor Mark as done", () => {
    const html = render({ ...STEP, status: "in_progress", approvalState: "rejected" });
    expect(html).not.toContain("Confirm this step");
    expect(html).not.toContain("Mark as done");
  });

  it("stored completed approved step: no actions, evidence box still offered", () => {
    const html = render({ ...STEP, status: "completed", approvalState: "approved" });
    expect(html).not.toContain("Confirm this step");
    expect(html).not.toContain("Mark as done");
    expect(html).toContain("Add evidence");
  });

  it("approval not required and in progress: Mark as done", () => {
    const html = render({ ...STEP, approvalRequired: false, approvalState: "not_required", status: "in_progress" });
    expect(html).toContain("Mark as done");
    expect(html).not.toContain("Confirm this step");
  });

  it("legacy QA row (approval required, state null, completed): no actions", () => {
    const html = render({ ...STEP, status: "completed", approvalState: null });
    expect(html).not.toContain("Confirm this step");
    expect(html).not.toContain("Mark as done");
  });
});
