import { describe, expect, it } from "vitest";

import { approvalLabelKey, LABEL_TEXT_EN } from "@/lib/care/rules/labels";
import { CareReferenceModel } from "@/lib/care/rules/model";
import type { PartSnapshot } from "@/lib/care/rules/types";
import { safeTimelineParams, timelineLabelKey } from "@/lib/care/timeline";
import { buildFeed, type FeedItemRow } from "@/lib/family/feed";
import { recipientSentences } from "@/lib/family/recipient-sentences";
import type { EventPart, SharedCareEvent } from "@/lib/family/shared-care-event";
import type { HouseholdRole } from "@/lib/households/membership";
import { en } from "@/lib/i18n/en";
import { createTranslator } from "@/lib/i18n/messages";

/**
 * Requirement 20 (family-shared-care): the whole family scenario, at the level of the
 * in-memory reference model and the pure read layer. No database. The DB variant is
 * `requirement20.integration.test.ts`.
 *
 * The model has no note-upload or recognition events (they belong to the note, before a
 * Care_Chain exists), so the three early Timeline events are written here by hand, exactly as
 * the SQL functions write them: note.uploaded (human), extraction_started (human who
 * started the run), extraction_succeeded (ai).
 */

const T0 = new Date("2026-03-02T09:00:00Z");
const after = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const NOTE = "note-1";
const PART = "part-clinic";
const tr = createTranslator("en");

const NAMES: Record<string, string> = { grandma: "Grandma", misa: "Misa", ken: "Ken", mia: "Mia" };

function clinicPart(): PartSnapshot {
  return {
    id: PART,
    householdId: "h1",
    careCategory: "appointment",
    riskLevel: "high",
    approvalRequired: true,
    storedApprovalState: "pending",
    legacyStatus: "pending_review",
    ownerId: null,
    driverId: null,
    companionId: null,
    backupOwnerId: null,
    taskDue: null,
    respondBy: null,
    evidenceRequired: ["Visit note"],
    evidenceAttached: [],
    planVersion: 1,
    rejectedAtPlanVersion: null,
  };
}

function newModel(): CareReferenceModel {
  const model = new CareReferenceModel();
  model.addHousehold("h1");
  model.addHousehold("h2");
  const roles: Record<string, HouseholdRole> = {
    grandma: "care_recipient",
    misa: "primary_caregiver",
    ken: "family_member",
    mia: "family_member",
  };
  for (const [memberId, role] of Object.entries(roles)) {
    model.addMember({ memberId, householdId: "h1", role, isActive: true });
  }
  model.addMember({ memberId: "outsider", householdId: "h2", role: "primary_caregiver", isActive: true });
  model.addPart(clinicPart(), NOTE);
  return model;
}

function ref(id: string | null) {
  return id ? { id, name: NAMES[id] ?? null } : null;
}

/** The read-layer view of the model's Part, as `getSharedCareEvent` would build it. */
function eventOf(model: CareReferenceModel, state: SharedCareEvent["state"]): SharedCareEvent {
  const p = model.getPart(PART)!;
  const attached = model.evidence(PART).map((e) => ({ id: e.id, kind: e.kind, label: e.label }));
  const part: EventPart = {
    id: p.id,
    title: "Attend clinic visit",
    description: null,
    careCategory: p.careCategory,
    riskLevel: p.riskLevel,
    progressStatus: p.legacyStatus,
    sourceQuote: null,
    confidence: null,
    approvalRequired: p.approvalRequired,
    approvalState: p.storedApprovalState ?? "pending",
    planVersion: p.planVersion,
    owner: ref(p.ownerId),
    driver: ref(p.driverId),
    companion: ref(p.companionId),
    backup: ref(p.backupOwnerId),
    suggestedRole: null,
    personToAsk: null,
    location: null,
    confirmed: { appointment: null, respondBy: null, taskDue: null },
    suggested: { appointment: null, respondBy: null, taskDue: null },
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [],
    evidence: { required: p.evidenceRequired, attachedCount: attached.length, attached },
  };
  const ready = state === "ready";
  return {
    noteId: NOTE,
    householdId: "h1",
    state,
    retryable: false,
    failureReason: null,
    chainId: ready ? "chain-1" : null,
    title: ready ? "Clinic visit" : null,
    riskLevel: ready ? "high" : null,
    createdAt: T0.toISOString(),
    parts: ready ? [part] : [],
    done: ready && p.legacyStatus === "completed",
  };
}

const sentences = (e: SharedCareEvent) => recipientSentences(e).map((s) => tr.t(s.key, s.params));
const approvalLabel = (model: CareReferenceModel) => {
  const p = model.getPart(PART)!;
  const key = approvalLabelKey({
    progressStatus: p.legacyStatus,
    approvalState: p.storedApprovalState ?? "pending",
  });
  return key ? LABEL_TEXT_EN[key] : null;
};

function feedRow(kind: string, at: Date): FeedItemRow {
  return {
    id: `${kind}-${at.getTime()}`,
    noteId: NOTE,
    careChainId: null,
    kind,
    createdAt: at.toISOString(),
    recipientMemberId: null,
    seenAt: null,
  };
}

describe("Requirement 20: the shared family scenario (reference model)", () => {
  it("runs from the photo to Done and shows every step in the Timeline, in order", () => {
    const model = newModel();

    // 20.1 and 20.2: Grandma's photo is stored, the feed shows it as "Being read" to Ken.
    const early = [
      { type: "note.uploaded", actor: "grandma", actorType: "human", at: after(0) },
      { type: "extraction_started", actor: "grandma", actorType: "human", at: after(1) },
      { type: "extraction_succeeded", actor: "ai", actorType: "ai", at: after(2) },
    ];
    const beingRead = buildFeed(
      [feedRow("event_created", after(0))],
      new Map([[NOTE, eventOf(model, "uploaded")]]),
      after(1),
      null,
      "ken",
    );
    expect(beingRead.events).toHaveLength(1);
    expect(beingRead.events[0]).toMatchObject({ state: "reading", title: null, titleKey: "feed.heading.beingRead" });
    expect(en["feed.heading.beingRead"]).toBe("Being read");
    expect(sentences(eventOf(model, "reading"))).toEqual(["Your family is reading your note."]);

    const ready = buildFeed(
      [feedRow("event_created", after(0)), feedRow("event_ready", after(2))],
      new Map([[NOTE, eventOf(model, "ready")]]),
      after(3),
      null,
      "ken",
    );
    expect(ready.events[0]).toMatchObject({ state: "ready", title: "Clinic visit", titleKey: null });

    // 20.3: Ken, who is not a Primary_Caregiver, claims the High_Risk_Part. Approval stays pending.
    expect(model.claim("ken", PART, "owner", after(10))).toMatchObject({ ok: true, approvalReset: false });
    expect(model.getPart(PART)).toMatchObject({ ownerId: "ken", storedApprovalState: "pending" });
    expect(approvalLabel(model)).toBe("Requires confirmation");
    expect(sentences(eventOf(model, "ready"))).toEqual([
      "No one is going with you yet.",
      "Ken is taking care of this.",
      "The time is not confirmed yet.",
      "Your family is checking this.",
    ]);

    // 20.4: Ken cannot approve. The refusal writes nothing.
    const logBefore = model.auditLog("h1").length;
    expect(model.decideApproval("ken", PART, "approve", after(11))).toEqual({
      ok: false,
      code: "not_primary_caregiver",
    });
    expect(model.auditLog("h1")).toHaveLength(logBefore);
    expect(model.auditLog("h1").some((e) => e.type.startsWith("approval."))).toBe(false);

    // 20.5: Ken asks Mia to take over. Ken stays Owner.
    const handover = model.requestHandover("ken", PART, "owner", "mia", after(20));
    expect(handover.ok).toBe(true);
    expect(model.getPart(PART)?.ownerId).toBe("ken");

    // 20.6: Mia accepts. Mia is Owner, approval is still pending (nothing to reset).
    const accepted = model.respondToRequest("mia", handover.ok ? handover.requestId! : "", true, after(30));
    expect(accepted).toMatchObject({ ok: true, outcome: "accepted", approvalReset: false });
    expect(model.getPart(PART)).toMatchObject({ ownerId: "mia", storedApprovalState: "pending" });
    expect(approvalLabel(model)).toBe("Requires confirmation");

    // 20.7: Misa, a Primary_Caregiver who is not the Owner, approves.
    expect(model.decideApproval("misa", PART, "approve", after(40))).toMatchObject({
      ok: true,
      outcome: "approved",
    });
    expect(model.getPart(PART)?.storedApprovalState).toBe("approved");
    expect(approvalLabel(model)).toBe("Confirmed");
    expect(sentences(eventOf(model, "ready"))).not.toContain("Your family is checking this.");

    // 20.8: Mia attaches the required Evidence and marks the Part done.
    expect(
      model.recordEvidence("mia", PART, { label: "Visit note", kind: "text", text: "Seen by the doctor" }, after(50)),
    ).toMatchObject({ ok: true });
    expect(model.complete("mia", PART, after(60))).toMatchObject({ ok: true, outcome: "completed" });
    expect(model.getPart(PART)?.legacyStatus).toBe("completed");
    expect(approvalLabel(model)).toBe("Done");
    expect(sentences(eventOf(model, "ready"))).toEqual(["Done."]);

    // 20.9 and 20.10: one ordered Timeline, early events included, with actors and labels.
    const log = model.auditLog("h1");
    const timeline = [
      ...early.map((e) => ({ type: e.type, actor: e.actor, payload: {} as Record<string, unknown>, at: e.at })),
      ...log.map((e) => ({ type: e.type, actor: e.actor, payload: e.payload, at: e.createdAt })),
    ];
    const primary = timeline.filter((e) => e.type !== "reminder.sent");
    expect(primary.map((e) => [e.type, e.actor])).toEqual([
      ["note.uploaded", "grandma"],
      ["extraction_started", "grandma"],
      ["extraction_succeeded", "ai"],
      ["part.claimed", "ken"],
      ["handover.requested", "ken"],
      ["handover.accepted", "mia"],
      ["approval.given", "misa"],
      ["evidence.uploaded", "mia"],
      ["part.completed", "mia"],
    ]);
    // Exactly one event per action; the refused approval left none.
    expect(primary.filter((e) => e.type.startsWith("approval."))).toHaveLength(1);
    expect(model.auditLog("h1").every((e) => e.noteId === NOTE)).toBe(true);
    // Reminders are system events and never reorder the rest.
    expect(timeline.filter((e) => e.type === "reminder.sent").every((e) => e.actor === "system")).toBe(true);
    const times = timeline.map((e) => e.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));

    expect(primary.map((e) => en[timelineLabelKey(e.type, e.payload) as keyof typeof en])).toEqual([
      "Note uploaded",
      "Fudepan started reading the note",
      "Fudepan finished reading the note",
      "Someone took this part",
      "A handover was requested",
      "The handover was accepted",
      "Confirmed by a household member",
      "Proof was added",
      "This part was marked done",
    ]);

    // No free text reaches the Timeline: the stored evidence text is nowhere in the audit log.
    expect(JSON.stringify(log)).not.toContain("Seen by the doctor");
    for (const e of timeline) {
      for (const value of Object.values(safeTimelineParams(e.payload))) {
        expect(typeof value === "string" ? value : "").not.toContain(" ");
      }
    }
  });

  it("keeps the Part's labels honest: Requires confirmation appears only while approval is pending", () => {
    const model = newModel();
    const seen: (string | null)[] = [approvalLabel(model)];
    model.claim("ken", PART, "owner", after(1));
    seen.push(approvalLabel(model));
    model.decideApproval("misa", PART, "approve", after(2));
    seen.push(approvalLabel(model));
    expect(seen).toEqual(["Requires confirmation", "Requires confirmation", "Confirmed"]);
  });
});
