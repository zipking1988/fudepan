import { describe, expect, it } from "vitest";

import { computeOffers, type ReceiverOption } from "./event-offers";
import type { EventPart } from "./shared-care-event";

const H = "00000000-0000-4000-8000-000000000001";
const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const NOW = new Date("2026-11-01T09:00:00Z");
const members: ReceiverOption[] = [
  { id: ME, name: "Aki", role: "family_member" },
  { id: OTHER, name: "Ben", role: "primary_caregiver" },
];

const part: EventPart = {
  id: "00000000-0000-4000-8000-0000000000b1",
  title: "Pick up the form",
  description: null,
  careCategory: "document",
  riskLevel: "high",
  progressStatus: "in_progress",
  sourceQuote: null,
  confidence: null,
  approvalRequired: true,
  approvalState: "pending",
  planVersion: 1,
  owner: null,
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
  evidence: { required: [], attachedCount: 0, attached: [] },
};

describe("computeOffers", () => {
  it("offers a care recipient nothing", () => {
    const o = computeOffers(part, { memberId: ME, householdId: H, role: "care_recipient" }, members, NOW);
    expect(o.none).toBe(true);
  });

  it("offers the owner claim only on a document part, and assignment to a primary caregiver", () => {
    const member = computeOffers(part, { memberId: ME, householdId: H, role: "family_member" }, members, NOW);
    expect(member.claim).toEqual(["owner"]);
    expect(member.requestAssignment).toBe(false);
    expect(member.approve).toBe(false);
    const primary = computeOffers(part, { memberId: OTHER, householdId: H, role: "primary_caregiver" }, members, NOW);
    expect(primary.requestAssignment).toBe(true);
    expect(primary.approve).toBe(true);
  });

  it("does not offer claim for a role already held", () => {
    const o = computeOffers({ ...part, owner: { id: OTHER, name: "Ben" } }, { memberId: ME, householdId: H, role: "family_member" }, members, NOW);
    expect(o.claim).toEqual([]);
  });

  it("offers completion to the Owner only once approved, and the backup prompt before a backup exists", () => {
    const owned = { ...part, owner: { id: ME, name: "Aki" } };
    const v = { memberId: ME, householdId: H, role: "family_member" as const };
    const pending = computeOffers(owned, v, members, NOW);
    expect(pending.complete).toBe(false);
    expect(pending.completeWaiting).toBe(true);
    expect(pending.backupPrompt).toBe(true);
    const approved = computeOffers({ ...owned, approvalState: "approved" }, v, members, NOW);
    expect(approved.complete).toBe(true);
  });

  it("offers Reopen to the Owner or a primary caregiver of a failed part", () => {
    const failed = { ...part, progressStatus: "failed", owner: { id: ME, name: "Aki" } };
    expect(computeOffers(failed, { memberId: ME, householdId: H, role: "family_member" }, members, NOW).reopen).toBe(true);
    expect(computeOffers(failed, { memberId: OTHER, householdId: H, role: "primary_caregiver" }, members, NOW).reopen).toBe(true);
    expect(computeOffers({ ...failed, owner: null }, { memberId: ME, householdId: H, role: "family_member" }, members, NOW).reopen).toBe(false);
  });
});
