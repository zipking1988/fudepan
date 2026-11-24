/**
 * Which buttons the Event_View offers one person on one Part (family-shared-care task 15.8).
 *
 * Pure: no I/O, no clock (callers pass `now`). The offers come from the same rule module the
 * server uses, so the page never offers what the rules would refuse. The server stays the
 * authority: it re-checks every action against the database.
 */
import { canResubmit, decideApproval, effectiveApprovalState } from "@/lib/care/rules/approval";
import { decideClaim, decideRelease, helperRolesOffered } from "@/lib/care/rules/claims";
import { decideCompletion, decideFailure, decideReopen } from "@/lib/care/rules/completion";
import {
  decideAssignmentRequest,
  decideBackupRequest,
  decideHandoverRequest,
  decideVolunteerBackup,
  eligibleReceivers,
  type CareRequestSnapshot,
} from "@/lib/care/rules/requests";
import type { RefusalCode } from "@/lib/care/rules/refusals";
import type { HelperRole, MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";
import { isHouseholdRole, type HouseholdRole } from "@/lib/households/membership";
import type { EventPart, EventTime, PendingRequestView } from "@/lib/family/shared-care-event";

export type EventViewer = { memberId: string; householdId: string; role: HouseholdRole };

/** An active member who could receive a request. */
export type ReceiverOption = { id: string; name: string; role: HouseholdRole };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The member list a card works with: active members with a known role, sorted by display name,
 * then id, so every caller passes the same list in the same order.
 */
export function receiverOptionsFrom(
  rows: readonly { id: string; displayName: string; role: string; isActive?: boolean }[],
): ReceiverOption[] {
  return rows
    .filter((m) => m.isActive !== false && isHouseholdRole(m.role))
    .map((m) => ({ id: m.id, name: m.displayName, role: m.role as HouseholdRole }))
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));
}

export type PartOffers = {
  claim: HelperRole[];
  release: HelperRole[];
  /** Roles the viewer holds but cannot give up because the task is due soon. */
  releaseBlocked: HelperRole[];
  handover: HelperRole[];
  /** People who may be asked to take over, take the task, or be the backup. */
  receivers: ReceiverOption[];
  requestAssignment: boolean;
  requestBackup: boolean;
  volunteerBackup: boolean;
  /** Pending requests addressed to the viewer. */
  respond: PendingRequestView[];
  approve: boolean;
  reject: boolean;
  /** The viewer is the Owner and approves: the approval is recorded as a self-approval. */
  selfApprovalNote: boolean;
  resubmit: boolean;
  complete: boolean;
  /** The Owner cannot finish yet because approval is not given. */
  completeWaiting: boolean;
  fail: boolean;
  reopen: boolean;
  addEvidence: boolean;
  /** The Owner just took the task and nobody is its backup yet. */
  backupPrompt: boolean;
  /** True when the viewer has nothing to do on this Part. */
  none: boolean;
};

function time(t: EventTime | null) {
  return t ? { at: new Date(t.at), timeZone: t.timeZone, provenance: t.provenance } : null;
}

export function toPartSnapshot(part: EventPart, householdId: string): PartSnapshot {
  return {
    id: part.id,
    householdId,
    careCategory: part.careCategory,
    riskLevel: part.riskLevel,
    approvalRequired: part.approvalRequired,
    storedApprovalState: part.approvalState,
    legacyStatus: part.progressStatus,
    ownerId: part.owner?.id ?? null,
    driverId: part.driver?.id ?? null,
    companionId: part.companion?.id ?? null,
    backupOwnerId: part.backup?.id ?? null,
    taskDue: time(part.confirmed.taskDue),
    respondBy: time(part.confirmed.respondBy),
    evidenceRequired: part.evidence.required,
    evidenceAttached: part.evidence.attached.map((e) => e.label),
    planVersion: part.planVersion,
    rejectedAtPlanVersion: null,
  };
}

export function toMemberSnapshot(viewer: EventViewer): MemberSnapshot {
  return { memberId: viewer.memberId, householdId: viewer.householdId, role: viewer.role, isActive: true };
}

function toRequestSnapshots(part: EventPart, householdId: string): CareRequestSnapshot[] {
  return part.pendingRequests.map((r) => ({
    id: r.id,
    careStepId: part.id,
    householdId,
    kind: r.kind === "handover" || r.kind === "backup" ? r.kind : "assignment",
    helperRole: r.helperRole === "owner" || r.helperRole === "driver" || r.helperRole === "companion" ? r.helperRole : null,
    requesterId: r.from.id,
    receiverId: r.to.id,
    status: "pending",
    expiresAt: new Date(r.expiresAt),
  }));
}

const ROLES: HelperRole[] = ["owner", "driver", "companion"];

function holder(part: EventPart, role: HelperRole) {
  return role === "owner" ? part.owner : role === "driver" ? part.driver : part.companion;
}

export function computeOffers(
  part: EventPart,
  viewer: EventViewer,
  members: readonly ReceiverOption[],
  now: Date,
): PartOffers {
  const snap = toPartSnapshot(part, viewer.householdId);
  const actor = toMemberSnapshot(viewer);
  const pending = toRequestSnapshots(part, viewer.householdId);
  const snapshots: MemberSnapshot[] = members.map((m) => ({
    memberId: m.id,
    householdId: viewer.householdId,
    role: m.role,
    isActive: true,
  }));
  const eligibleIds = new Set(eligibleReceivers(snap, actor, snapshots).map((m) => m.memberId));
  const receivers = members.filter((m) => eligibleIds.has(m.id));
  const firstReceiver = snapshots.find((m) => eligibleIds.has(m.memberId)) ?? null;

  const offered = helperRolesOffered(snap);
  const claim = offered.filter((r) => decideClaim(snap, actor, r).ok);

  const release: HelperRole[] = [];
  const releaseBlocked: HelperRole[] = [];
  for (const role of ROLES) {
    if (holder(part, role)?.id !== viewer.memberId) continue;
    const d = decideRelease(snap, actor, role, now);
    if (d.ok) release.push(role);
    else if (d.code === ("release_blocked_due_soon" satisfies RefusalCode)) releaseBlocked.push(role);
  }

  const handover = ROLES.filter(
    (role) =>
      holder(part, role)?.id === viewer.memberId &&
      firstReceiver !== null &&
      decideHandoverRequest(snap, actor, role, firstReceiver, pending, now).ok,
  );

  const requestAssignment =
    part.owner === null &&
    firstReceiver !== null &&
    decideAssignmentRequest(snap, actor, firstReceiver, pending, now).ok;
  const requestBackup =
    firstReceiver !== null &&
    receivers.some((m) => m.id !== snap.ownerId) &&
    decideBackupRequest(
      snap,
      actor,
      snapshots.find((m) => eligibleIds.has(m.memberId) && m.memberId !== snap.ownerId) ?? null,
      pending,
      now,
    ).ok;
  const volunteerBackup = decideVolunteerBackup(snap, actor).ok;

  const respond = part.pendingRequests.filter(
    (r) => r.to.id === viewer.memberId && viewer.role !== "care_recipient",
  );

  const state = effectiveApprovalState(snap);
  // The count is read by the server at the moment of the action. 1 never hides the button.
  const approveDecision = decideApproval(snap, actor, 1, "approve");
  const rejectDecision = decideApproval(snap, actor, 1, "reject");
  const approve = approveDecision.ok && state === "pending";
  const reject = rejectDecision.ok && (state === "pending" || state === "approved");
  const selfApprovalNote = (approve || reject) && snap.ownerId === viewer.memberId;

  const resubmit =
    state === "rejected" && canResubmit(snap, actor, { explanation: "x" }).ok;

  const completion = decideCompletion(snap, actor);
  const complete = completion.ok;
  const completeWaiting = !completion.ok && completion.code === "approval_pending";

  const fail = decideFailure(snap, actor).ok;
  const reopen = decideReopen(snap, actor).ok;

  const closed = part.progressStatus === "completed" || part.progressStatus === "cancelled";
  const isHelper = [part.owner, part.driver, part.companion].some((h) => h?.id === viewer.memberId);
  const addEvidence =
    !closed && viewer.role !== "care_recipient" && (isHelper || viewer.role === "primary_caregiver");

  const backupPrompt =
    part.owner?.id === viewer.memberId &&
    part.backup === null &&
    !closed &&
    !part.pendingRequests.some((r) => r.kind === "backup") &&
    requestBackup;

  const base = {
    claim,
    release,
    releaseBlocked,
    handover,
    receivers,
    requestAssignment,
    requestBackup,
    volunteerBackup,
    respond,
    approve,
    reject,
    selfApprovalNote,
    resubmit,
    complete,
    completeWaiting,
    fail,
    reopen,
    addEvidence,
    backupPrompt,
  };
  const none =
    claim.length +
      release.length +
      releaseBlocked.length +
      handover.length +
      respond.length === 0 &&
    !requestAssignment &&
    !requestBackup &&
    !volunteerBackup &&
    !approve &&
    !reject &&
    !resubmit &&
    !complete &&
    !completeWaiting &&
    !fail &&
    !reopen &&
    !addEvidence;
  return { ...base, none };
}
