/**
 * In-memory reference model of the Action_Guard (family-shared-care design,
 * "Correctness Properties" and "SQL functions (Action_Guard)").
 *
 * It is a deterministic state machine over households, members, parts,
 * requests, audit events, and feed items. Every action calls the pure `decide*`
 * functions of this folder and then applies the writes the SQL function of the
 * same name is specified to make. It is the oracle for the property tests and
 * for the SQL functions. Pure TypeScript: no I/O, no clock (callers pass
 * `now`), ids come from counters.
 *
 * A refused action writes nothing. A successful action writes exactly one
 * primary audit event and one household Feed_Item linked to it, plus
 * `approval.reset` when a people change resets approval, plus one
 * `reminder.sent` audit event and one addressed Feed_Item per In_App_Reminder.
 * The committed outcomes `expired` and `evidence_required` write their own
 * primary event and return `ok: true`.
 */
import {
  decideApproval,
  canResubmit,
  effectiveApprovalState,
  isHighRiskPart,
} from "@/lib/care/rules/approval";
import { decideClaim, decideRelease } from "@/lib/care/rules/claims";
import { decideCompletion, decideFailure, decideReopen } from "@/lib/care/rules/completion";
import { escalationCandidates, type EscalationLedgerEntry } from "@/lib/care/rules/escalation";
import type { RefusalCode } from "@/lib/care/rules/refusals";
import {
  decideAssignmentRequest,
  decideBackupRequest,
  decideHandoverRequest,
  decideRequestResponse,
  decideVolunteerBackup,
  type CareRequestSnapshot,
  type RequestPlan,
} from "@/lib/care/rules/requests";
import type { HelperRole, MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

export type ModelAuditEvent = {
  id: string;
  seq: number;
  householdId: string;
  type: string;
  /** A member id, `system`, or `ai`. */
  actor: string;
  careStepId: string | null;
  noteId: string | null;
  createdAt: Date;
  /** IDs, codes, counts, ISO times only (Requirement 15.3). */
  payload: Record<string, unknown>;
};

export type ModelFeedItem = {
  id: string;
  seq: number;
  householdId: string;
  kind: string;
  auditEventId: string;
  careStepId: string | null;
  noteId: string | null;
  actorMemberId: string | null;
  /** Null for a household Feed_Item, a member id for an In_App_Reminder. */
  recipientMemberId: string | null;
  params: Record<string, unknown>;
  createdAt: Date;
  seenAt: Date | null;
};

export type ModelEvidence = {
  id: string;
  seq: number;
  careStepId: string;
  memberId: string;
  label: string;
  kind: "file" | "text";
  storagePath: string | null;
  text: string | null;
};

export type ModelResubmission = {
  id: string;
  careStepId: string;
  memberId: string;
  explanation: string | null;
};

export type ModelSuccess = {
  ok: true;
  /** `done`, `completed`, `evidence_required`, `expired`, `accepted`, `declined`, ... */
  outcome: string;
  auditEventId: string;
  approvalReset: boolean;
  requestId?: string;
  missing?: string[];
};

export type ModelRefusal = {
  ok: false;
  code: RefusalCode;
  /** For `already_claimed`: who holds the role. */
  holderId?: string | null;
  /** For `not_owner`: who the Owner is. */
  ownerId?: string | null;
};

export type ModelResult = ModelSuccess | ModelRefusal;

export type EvidenceInput = {
  label: string;
  kind: "file" | "text";
  storagePath?: string | null;
  text?: string | null;
};

const ROLE_COLUMN = {
  owner: "ownerId",
  driver: "driverId",
  companion: "companionId",
} as const satisfies Record<HelperRole, keyof PartSnapshot>;

const CLAIM_EVENT: Record<HelperRole, string> = {
  owner: "part.claimed",
  driver: "part.driver_volunteered",
  companion: "part.companion_volunteered",
};

const EXPIRED_EVENT = {
  assignment: "assignment.expired",
  handover: "handover.not_accepted",
  backup: "backup.expired",
} as const;

function refuse(code: RefusalCode, extra: Partial<ModelRefusal> = {}): ModelRefusal {
  return { ok: false, code, ...extra };
}

function isFinished(part: Pick<PartSnapshot, "legacyStatus">): boolean {
  return part.legacyStatus === "completed" || part.legacyStatus === "cancelled";
}

export class CareReferenceModel {
  private households = new Set<string>();
  private members = new Map<string, MemberSnapshot>();
  private parts = new Map<string, PartSnapshot>();
  private partNotes = new Map<string, string | null>();
  private requestList = new Map<string, CareRequestSnapshot>();
  private audit: ModelAuditEvent[] = [];
  private feedItems: ModelFeedItem[] = [];
  private evidenceList: ModelEvidence[] = [];
  private resubmissionList: ModelResubmission[] = [];
  private ledger: EscalationLedgerEntry[] = [];
  /** Sequence number of the rejection event, per Part (to count Evidence added since). */
  private rejectedSeq = new Map<string, number>();
  private seq = 0;

  // ---------------------------------------------------------------- setup

  addHousehold(householdId: string): void {
    this.households.add(householdId);
  }

  addMember(member: MemberSnapshot): void {
    if (!this.households.has(member.householdId)) {
      throw new Error(`Unknown household ${member.householdId}`);
    }
    this.members.set(member.memberId, { ...member });
  }

  /** Changes a member's role or active flag. Rules read this at processing time (9.14). */
  updateMember(
    memberId: string,
    changes: Partial<Pick<MemberSnapshot, "role" | "isActive">>,
  ): void {
    const current = this.members.get(memberId);
    if (!current) throw new Error(`Unknown member ${memberId}`);
    this.members.set(memberId, { ...current, ...changes });
  }

  addPart(part: PartSnapshot, noteId: string | null = null): void {
    if (!this.households.has(part.householdId)) {
      throw new Error(`Unknown household ${part.householdId}`);
    }
    this.parts.set(part.id, structuredClone(part));
    this.partNotes.set(part.id, noteId);
  }

  // ------------------------------------------------------------ inspection

  getPart(partId: string): PartSnapshot | null {
    const part = this.parts.get(partId);
    return part ? structuredClone(part) : null;
  }

  getMember(memberId: string): MemberSnapshot | null {
    const member = this.members.get(memberId);
    return member ? { ...member } : null;
  }

  getRequest(requestId: string): CareRequestSnapshot | null {
    const request = this.requestList.get(requestId);
    return request ? structuredClone(request) : null;
  }

  requests(partId?: string): CareRequestSnapshot[] {
    return [...this.requestList.values()]
      .filter((r) => partId === undefined || r.careStepId === partId)
      .map((r) => structuredClone(r));
  }

  auditLog(householdId?: string): ModelAuditEvent[] {
    return this.audit
      .filter((e) => householdId === undefined || e.householdId === householdId)
      .map((e) => structuredClone(e));
  }

  feed(householdId?: string): ModelFeedItem[] {
    return this.feedItems
      .filter((f) => householdId === undefined || f.householdId === householdId)
      .map((f) => structuredClone(f));
  }

  evidence(partId?: string): ModelEvidence[] {
    return this.evidenceList
      .filter((e) => partId === undefined || e.careStepId === partId)
      .map((e) => ({ ...e }));
  }

  resubmissions(partId?: string): ModelResubmission[] {
    return this.resubmissionList
      .filter((r) => partId === undefined || r.careStepId === partId)
      .map((r) => ({ ...r }));
  }

  escalationLedger(): EscalationLedgerEntry[] {
    return this.ledger.map((l) => ({ ...l, deadlineAt: new Date(l.deadlineAt) }));
  }

  // --------------------------------------------------------------- actions

  /** claim_part (5.1, 5.4, 5.5, 5.13, 6.2-6.4, 9.22). */
  claim(actorId: string, partId: string, role: HelperRole, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const { part, actor } = ctx;

    const decision = decideClaim(part, actor, role);
    if (!decision.ok) {
      return refuse(
        decision.code,
        decision.code === "already_claimed" ? { holderId: part[ROLE_COLUMN[role]] } : {},
      );
    }

    const changed = this.applyPeopleChange(part, decision.value);
    let next = changed.part;
    if (role === "owner" && next.legacyStatus === "pending_review") {
      next = { ...next, legacyStatus: "in_progress" };
    }
    this.parts.set(part.id, next);

    const event = this.record(CLAIM_EVENT[role], next, actor.memberId, { role }, now, { role });
    this.afterReset(changed.reset, next, role, actor.memberId, now);
    return this.success("claimed", event, changed.reset);
  }

  /** release_part (7.1-7.4, 9.22, 21.4). */
  release(actorId: string, partId: string, role: HelperRole, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const { part, actor } = ctx;

    const decision = decideRelease(part, actor, role, now);
    if (!decision.ok) return refuse(decision.code);

    const changed = this.applyPeopleChange(part, decision.value);
    this.parts.set(part.id, changed.part);

    const event = this.record("part.released", changed.part, actor.memberId, { role }, now, {
      role,
      needsSomeone: true,
    });
    this.afterReset(changed.reset, changed.part, role, actor.memberId, now);
    return this.success("released", event, changed.reset);
  }

  /** request_assignment (5.7, 5.9, 5.12, 21.1). */
  requestAssignment(actorId: string, partId: string, toMemberId: string, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const decision = decideAssignmentRequest(
      ctx.part,
      ctx.actor,
      this.members.get(toMemberId) ?? null,
      this.pendingFor(partId),
      now,
    );
    if (!decision.ok) return refuse(decision.code);
    return this.createRequest(ctx.part, ctx.actor, toMemberId, decision.value, now);
  }

  /** request_handover (8.1-8.3, 8.8, 8.10). */
  requestHandover(
    actorId: string,
    partId: string,
    role: HelperRole,
    toMemberId: string,
    now: Date,
  ): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const decision = decideHandoverRequest(
      ctx.part,
      ctx.actor,
      role,
      this.members.get(toMemberId) ?? null,
      this.pendingFor(partId),
      now,
    );
    if (!decision.ok) return refuse(decision.code);
    return this.createRequest(ctx.part, ctx.actor, toMemberId, decision.value, now);
  }

  /** request_backup (5.14, 21.5, D-1, D-2). */
  requestBackup(actorId: string, partId: string, toMemberId: string, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const decision = decideBackupRequest(
      ctx.part,
      ctx.actor,
      this.members.get(toMemberId) ?? null,
      this.pendingFor(partId),
      now,
    );
    if (!decision.ok) return refuse(decision.code);
    return this.createRequest(ctx.part, ctx.actor, toMemberId, decision.value, now);
  }

  /** volunteer_backup (5.17). */
  volunteerBackup(actorId: string, partId: string, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const decision = decideVolunteerBackup(ctx.part, ctx.actor);
    if (!decision.ok) return refuse(decision.code);

    this.parts.set(ctx.part.id, decision.value);
    const event = this.record(
      "backup.accepted",
      decision.value,
      ctx.actor.memberId,
      { volunteered: true },
      now,
      { volunteered: true },
    );
    return this.success("volunteered", event, false);
  }

  /** respond_to_request (5.10, 5.11, 5.15, 5.16, 8.4-8.7, 8.11, 8.12, 21.6). */
  respondToRequest(actorId: string, requestId: string, accept: boolean, now: Date): ModelResult {
    const request = this.requestList.get(requestId);
    const actor = this.members.get(actorId);
    if (!request || !actor) return refuse("request_not_found");
    const part = this.parts.get(request.careStepId);
    if (!part) return refuse("request_not_found");

    const decision = decideRequestResponse(request, part, actor, now, accept);
    if (!decision.ok) return refuse(decision.code);
    const value = decision.value;
    const kind = request.kind;

    if (value.outcome === "expired") {
      return this.closeExpired(request, part, now, actor.memberId);
    }

    if (value.outcome === "declined") {
      this.requestList.set(request.id, { ...request, status: "declined" });
      const reason = "reason" in value ? value.reason : null;
      const event = this.record(
        `${kind}.declined`,
        part,
        actor.memberId,
        reason ? { request_id: request.id, reason } : { request_id: request.id },
        now,
        { requestId: request.id },
      );
      this.remind(part, request.requesterId, `${kind}_declined`, now);
      return this.success("declined", event, false, { requestId: request.id });
    }

    // accepted
    this.requestList.set(request.id, { ...request, status: "accepted" });
    const role: HelperRole | null =
      kind === "backup" ? null : kind === "assignment" ? "owner" : (request.helperRole ?? "owner");

    let next = value.part;
    let reset = false;
    if (role !== null && part[ROLE_COLUMN[role]] !== next[ROLE_COLUMN[role]]) {
      const changed = this.applyPeopleChange(part, next);
      next = changed.part;
      reset = changed.reset;
    }
    if (role === "owner" && next.legacyStatus === "pending_review") {
      next = { ...next, legacyStatus: "in_progress" };
    }
    this.parts.set(part.id, next);

    const event = this.record(
      `${kind}.accepted`,
      next,
      actor.memberId,
      role ? { request_id: request.id, role } : { request_id: request.id },
      now,
      { requestId: request.id },
    );
    if (role !== null) this.afterReset(reset, next, role, actor.memberId, now);
    return this.success("accepted", event, reset, { requestId: request.id });
  }

  /**
   * expire_care_requests (8.6, 8.9, 8.12, D-1). Closes every pending request of
   * the household whose expiry is reached. Returns how many it closed.
   */
  expireCareRequests(householdId: string, now: Date): number {
    let count = 0;
    for (const request of [...this.requestList.values()]) {
      if (
        request.householdId !== householdId ||
        request.status !== "pending" ||
        request.expiresAt.getTime() > now.getTime()
      ) {
        continue;
      }
      const part = this.parts.get(request.careStepId);
      if (!part) continue;
      this.closeExpired(request, part, now, "system");
      count += 1;
    }
    return count;
  }

  /** decide_approval (9.2, 9.5-9.7, 9.13, 9.14, 9.16). Progress_Status is untouched. */
  decideApproval(
    actorId: string,
    partId: string,
    decision: "approve" | "reject",
    now: Date,
  ): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const { part, actor } = ctx;

    const decided = decideApproval(
      part,
      actor,
      this.activePrimaryCount(part.householdId),
      decision,
    );
    if (!decided.ok) return refuse(decided.code);
    if (isFinished(part)) return refuse("part_closed");

    const { state, selfApproval } = decided.value;
    const next: PartSnapshot = {
      ...part,
      storedApprovalState: state,
      rejectedAtPlanVersion: state === "rejected" ? part.planVersion : part.rejectedAtPlanVersion,
    };
    this.parts.set(part.id, next);

    const event =
      state === "approved"
        ? this.record(
            "approval.given",
            next,
            actor.memberId,
            { self_approval: selfApproval },
            now,
            {
              selfApproval,
            },
          )
        : this.record("approval.rejected", next, actor.memberId, {}, now, {});
    if (state === "rejected") this.rejectedSeq.set(part.id, event.seq);
    return this.success(state, event, false);
  }

  /** resubmit_part (9.17-9.20). The explanation stays in `resubmissions()`, never in a payload. */
  resubmit(
    actorId: string,
    partId: string,
    input: { explanation?: string | null },
    now: Date,
  ): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const { part, actor } = ctx;

    const since = this.rejectedSeq.get(part.id);
    const newEvidenceCount =
      since === undefined
        ? 0
        : this.evidenceList.filter((e) => e.careStepId === part.id && e.seq > since).length;

    const decision = canResubmit(part, actor, { explanation: input.explanation, newEvidenceCount });
    if (!decision.ok) {
      return refuse(decision.code, decision.code === "not_owner" ? { ownerId: part.ownerId } : {});
    }

    const added: string[] = [];
    if ((input.explanation ?? "").trim().length > 0) added.push("explanation");
    if (newEvidenceCount > 0) added.push("evidence");
    if (part.rejectedAtPlanVersion !== null && part.planVersion > part.rejectedAtPlanVersion) {
      added.push("changed_plan");
    }

    this.parts.set(part.id, { ...part, storedApprovalState: decision.value });
    this.resubmissionList.push({
      id: this.nextId("resubmission"),
      careStepId: part.id,
      memberId: actor.memberId,
      explanation: input.explanation ?? null,
    });
    const event = this.record("approval.resubmitted", part, actor.memberId, { added }, now, {});
    for (const id of this.activePrimaryIds(part.householdId)) {
      this.remind(part, id, "approval_resubmitted", now);
    }
    return this.success("resubmitted", event, false);
  }

  /** complete_part (9.3, 11.1, 11.3, 11.6-11.8). `evidence_required` is a committed outcome. */
  complete(actorId: string, partId: string, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const { part, actor } = ctx;

    const decision = decideCompletion(part, actor);
    if (!decision.ok) {
      return refuse(decision.code, decision.code === "not_owner" ? { ownerId: part.ownerId } : {});
    }

    if (decision.value.outcome === "evidence_required") {
      const missing = decision.value.missing;
      const next = { ...part, legacyStatus: "evidence_required" };
      this.parts.set(part.id, next);
      const event = this.record(
        "part.evidence_missing",
        next,
        actor.memberId,
        { missing_count: missing.length },
        now,
        { missingCount: missing.length },
      );
      return this.success("evidence_required", event, false, { missing });
    }

    const next = { ...part, legacyStatus: "completed" };
    this.parts.set(part.id, next);
    const event = this.record("part.completed", next, actor.memberId, {}, now, {});
    return this.success("completed", event, false);
  }

  /** report_part_failed (11.4). */
  reportFailed(actorId: string, partId: string, reasonCode: string, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const { part, actor } = ctx;

    const decision = decideFailure(part, actor);
    if (!decision.ok) return refuse(decision.code);

    const next = { ...part, legacyStatus: decision.value };
    this.parts.set(part.id, next);
    const event = this.record(
      "part.failed",
      next,
      actor.memberId,
      { reason_code: reasonCode },
      now,
      { needsAttention: true },
    );
    return this.success("failed", event, false);
  }

  /** reopen_part (12.13, D-2). Approval_State is unchanged. */
  reopen(actorId: string, partId: string, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const { part, actor } = ctx;

    const decision = decideReopen(part, actor);
    if (!decision.ok) return refuse(decision.code);

    const next = { ...part, legacyStatus: decision.value };
    this.parts.set(part.id, next);
    const event = this.record("part.reopened", next, actor.memberId, {}, now, {});
    return this.success("reopened", event, false);
  }

  /**
   * record_evidence (11.2). Any Helper of the Part may add Evidence. The path or
   * text is stored in `evidence()`, never in the audit payload (15.3).
   */
  recordEvidence(actorId: string, partId: string, input: EvidenceInput, now: Date): ModelResult {
    const ctx = this.context(actorId, partId);
    if (!ctx.ok) return ctx.refusal;
    const { part, actor } = ctx;

    if (actor.role === "care_recipient") return refuse("recipient_read_only");
    const isHelper =
      part.ownerId === actor.memberId ||
      part.driverId === actor.memberId ||
      part.companionId === actor.memberId;
    if (!isHelper) return refuse("not_holder");

    const label = input.label.trim();
    const hasPath = (input.storagePath ?? "").trim().length > 0;
    const hasText = (input.text ?? "").trim().length > 0;
    if (label.length === 0 || (input.kind === "file" ? !hasPath : !hasText)) {
      return refuse("invalid_input");
    }

    this.evidenceList.push({
      id: this.nextId("evidence"),
      seq: ++this.seq,
      careStepId: part.id,
      memberId: actor.memberId,
      label,
      kind: input.kind,
      storagePath: input.kind === "file" ? (input.storagePath ?? null) : null,
      text: input.kind === "text" ? (input.text ?? null) : null,
    });
    const attached = part.evidenceAttached.includes(label)
      ? part.evidenceAttached
      : [...part.evidenceAttached, label];
    const next = { ...part, evidenceAttached: attached };
    this.parts.set(part.id, next);

    const labelIndex = part.evidenceRequired.indexOf(label);
    const event = this.record(
      "evidence.uploaded",
      next,
      actor.memberId,
      { kind: input.kind, label_index: labelIndex >= 0 ? labelIndex : null },
      now,
      { kind: input.kind },
    );
    return this.success("recorded", event, false);
  }

  /**
   * escalate_due_parts (8.13, 12.1-12.14). Expires requests first, then applies
   * `escalationCandidates` to the household. Returns the number of escalations.
   */
  escalateDueParts(householdId: string, now: Date): number {
    this.expireCareRequests(householdId, now);

    const parts = [...this.parts.values()].filter((p) => p.householdId === householdId);
    const members = [...this.members.values()].filter((m) => m.householdId === householdId);
    const plans = escalationCandidates(parts, this.ledger, now, members);

    for (const plan of plans) {
      const part = this.parts.get(plan.careStepId);
      if (!part) continue;
      this.ledger.push({
        careStepId: plan.careStepId,
        deadlineKind: plan.deadlineKind,
        deadlineAt: new Date(plan.deadlineAt),
      });
      const next = { ...part, legacyStatus: plan.newStatus };
      this.parts.set(part.id, next);
      this.record(plan.auditEvent.type, next, "system", { reason: plan.deadlineKind }, now, {
        reason: plan.deadlineKind,
        notified: plan.reminderRecipients,
      });
      for (const recipient of plan.reminderRecipients) {
        this.remind(next, recipient, `escalated_${plan.deadlineKind}`, now);
      }
    }
    return plans.length;
  }

  // -------------------------------------------------------------- internals

  private context(
    actorId: string,
    partId: string,
  ):
    { ok: true; part: PartSnapshot; actor: MemberSnapshot } | { ok: false; refusal: ModelRefusal } {
    const part = this.parts.get(partId);
    const actor = this.members.get(actorId);
    // A missing Part, a Part of another household, and an inactive actor look the same (14.2).
    if (!part || !actor || !actor.isActive || actor.householdId !== part.householdId) {
      return { ok: false, refusal: refuse("part_not_found") };
    }
    return { ok: true, part, actor };
  }

  private pendingFor(partId: string): CareRequestSnapshot[] {
    return [...this.requestList.values()].filter(
      (r) => r.careStepId === partId && r.status === "pending",
    );
  }

  private activePrimaryIds(householdId: string): string[] {
    return [...this.members.values()]
      .filter((m) => m.householdId === householdId && m.isActive && m.role === "primary_caregiver")
      .map((m) => m.memberId);
  }

  private activePrimaryCount(householdId: string): number {
    return this.activePrimaryIds(householdId).length;
  }

  private nextId(prefix: string): string {
    return `${prefix}-${++this.seq}`;
  }

  /**
   * apply_people_change: materializes the effective approval state, resets
   * `approved` on a High_Risk_Part (already decided by the rule), and bumps
   * `planVersion` when the state was `approved` or `rejected` on a High_Risk_Part.
   */
  private applyPeopleChange(
    before: PartSnapshot,
    after: PartSnapshot,
  ): { part: PartSnapshot; reset: boolean } {
    const was = effectiveApprovalState(before);
    const now = effectiveApprovalState(after);
    const high = isHighRiskPart(after);
    const bump = high && (was === "approved" || was === "rejected");
    return {
      part: {
        ...after,
        storedApprovalState: now,
        planVersion: after.planVersion + (bump ? 1 : 0),
      },
      reset: high && was === "approved" && now === "pending",
    };
  }

  private afterReset(
    reset: boolean,
    part: PartSnapshot,
    role: HelperRole,
    actorId: string,
    now: Date,
  ): void {
    if (!reset) return;
    this.emit("approval.reset", part, actorId, { changed: role }, now);
    for (const id of this.activePrimaryIds(part.householdId)) {
      this.remind(part, id, "approval_reset", now);
    }
  }

  private emit(
    type: string,
    part: PartSnapshot,
    actor: string,
    payload: Record<string, unknown>,
    now: Date,
  ): ModelAuditEvent {
    const seq = ++this.seq;
    const event: ModelAuditEvent = {
      id: `audit-${seq}`,
      seq,
      householdId: part.householdId,
      type,
      actor,
      careStepId: part.id,
      noteId: this.partNotes.get(part.id) ?? null,
      createdAt: new Date(now),
      payload,
    };
    this.audit.push(event);
    return event;
  }

  /** One primary audit event and one household Feed_Item linked to it. */
  private record(
    type: string,
    part: PartSnapshot,
    actor: string,
    payload: Record<string, unknown>,
    now: Date,
    params: Record<string, unknown>,
  ): ModelAuditEvent {
    const event = this.emit(type, part, actor, payload, now);
    this.addFeed(
      event,
      part,
      type,
      actor === "system" || actor === "ai" ? null : actor,
      null,
      params,
      now,
    );
    return event;
  }

  /** One In_App_Reminder: an addressed Feed_Item plus one `reminder.sent` event. */
  private remind(part: PartSnapshot, recipientId: string, kind: string, now: Date): void {
    const event = this.emit(
      "reminder.sent",
      part,
      "system",
      { channel: "in_app", recipient_member_id: recipientId, kind },
      now,
    );
    this.addFeed(event, part, kind, null, recipientId, {}, now);
  }

  private addFeed(
    event: ModelAuditEvent,
    part: PartSnapshot,
    kind: string,
    actorMemberId: string | null,
    recipientMemberId: string | null,
    params: Record<string, unknown>,
    now: Date,
  ): void {
    const seq = ++this.seq;
    this.feedItems.push({
      id: `feed-${seq}`,
      seq,
      householdId: part.householdId,
      kind,
      auditEventId: event.id,
      careStepId: part.id,
      noteId: this.partNotes.get(part.id) ?? null,
      actorMemberId,
      recipientMemberId,
      params,
      createdAt: new Date(now),
      seenAt: null,
    });
  }

  private success(
    outcome: string,
    event: ModelAuditEvent,
    approvalReset: boolean,
    extra: Partial<ModelSuccess> = {},
  ): ModelSuccess {
    return { ok: true, outcome, auditEventId: event.id, approvalReset, ...extra };
  }

  private createRequest(
    part: PartSnapshot,
    actor: MemberSnapshot,
    toMemberId: string,
    plan: RequestPlan,
    now: Date,
  ): ModelResult {
    const request: CareRequestSnapshot = {
      id: this.nextId("request"),
      careStepId: part.id,
      householdId: part.householdId,
      kind: plan.kind,
      helperRole: plan.helperRole,
      requesterId: actor.memberId,
      receiverId: toMemberId,
      status: "pending",
      expiresAt: new Date(plan.expiresAt),
    };
    this.requestList.set(request.id, request);

    const payload: Record<string, unknown> = {
      request_id: request.id,
      receiver_member_id: toMemberId,
      expires_at: plan.expiresAt.toISOString(),
      expiry_rule: plan.expiryRule,
    };
    if (plan.helperRole !== null) payload.role = plan.helperRole;
    const event = this.record(`${plan.kind}.requested`, part, actor.memberId, payload, now, {
      requestId: request.id,
    });
    this.remind(part, toMemberId, `${plan.kind}_requested`, now);
    return this.success("requested", event, false, { requestId: request.id });
  }

  /** The expired branch of respond_to_request and expire_care_requests. */
  private closeExpired(
    request: CareRequestSnapshot,
    part: PartSnapshot,
    now: Date,
    actor: string,
  ): ModelResult {
    this.requestList.set(request.id, { ...request, status: "expired" });
    const payload: Record<string, unknown> = { request_id: request.id };
    if (request.helperRole !== null) payload.role = request.helperRole;
    const event = this.record(EXPIRED_EVENT[request.kind], part, actor, payload, now, {
      requestId: request.id,
    });
    this.remind(part, request.requesterId, `${request.kind}_expired`, now);
    this.remind(part, request.receiverId, `${request.kind}_expired`, now);
    return this.success("expired", event, false, { requestId: request.id });
  }
}
