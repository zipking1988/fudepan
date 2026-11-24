/**
 * The interactive example on the landing page: one fictional household, one
 * note, four tasks. Kept in the browser only; nothing here reads or writes
 * Supabase or calls ai&.
 *
 * Every change goes through the same pure rule module the server uses
 * (`decideClaim`, `decideRelease`, `decideApproval`, `decideCompletion`), so
 * the example cannot do anything the real app would refuse. The visitor picks
 * who they act as (Misa, Kenta, or Yui); the rules then decide what that
 * person may do.
 *
 * Example-only checks sit on top of the rules:
 * - The clinic task is done only when its owner types a clinic name. It is
 *   modelled as required evidence (`clinic_name`), so `decideCompletion`
 *   refuses it until the name is attached.
 * - The visit cannot be confirmed or marked as done while the clinic is
 *   unknown, or while nobody has taken on going along with her (the
 *   companion). Fudepan never fills in either one.
 */
import { z } from "zod";
import type { CareCategory } from "@/lib/ai/schema";
import { APPOINTMENT_LOCATION_MAX } from "@/lib/care/appointment";
import type { RiskLevel } from "@/lib/care/risk";
import {
  decideApproval,
  effectiveApprovalState,
  isHighRiskPart,
  nextApprovalStateOnChange,
} from "@/lib/care/rules/approval";
import { decideClaim, decideRelease } from "@/lib/care/rules/claims";
import { decideCompletion } from "@/lib/care/rules/completion";
import type { RefusalCode } from "@/lib/care/rules/refusals";
import type { ApprovalState, HelperRole, MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

const HOUSEHOLD = "landing-example";

export type PersonId = "misa" | "kenta" | "yui";

export const PEOPLE: readonly { id: PersonId; role: "primary_caregiver" | "family_member" }[] = [
  { id: "misa", role: "primary_caregiver" },
  { id: "kenta", role: "family_member" },
  { id: "yui", role: "family_member" },
];

/** The person the visitor acts as when the page opens, and after "Start over". */
export const DEFAULT_PERSON: PersonId = "yui";

/** Misa: the only primary caregiver, so the only person who can confirm a high-risk task. */
export const PRIMARY: PersonId = PEOPLE.find((p) => p.role === "primary_caregiver")?.id ?? "misa";

const ACTIVE_PRIMARY_COUNT = PEOPLE.filter((p) => p.role === "primary_caregiver").length;

export type TaskId = "card" | "clinic" | "visit" | "glasses";
export type TaskStatus = "open" | "in_progress" | "completed";

/** Evidence label for the clinic task: the clinic name a family member typed in. */
export const CLINIC_EVIDENCE = "clinic_name";

export type ExampleTask = {
  id: TaskId;
  careCategory: CareCategory;
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  approvalState: ApprovalState;
  /** The role a family member takes on when they claim this task. */
  claimRole: HelperRole;
  holders: Record<HelperRole, PersonId | null>;
  status: TaskStatus;
  /** Index of the line in Grandma's note (the transcript in content.ts) this task comes from. */
  noteLine: number;
  /** The person the note says to ask. A hint only: it never makes that person the owner. */
  askPerson: PersonId | null;
  /** Evidence needed before the task can be marked as done. */
  evidenceRequired: readonly string[];
  /**
   * What the note does not say. The clinic name stays "not confirmed" until a
   * family member fills it in through the clinic task; Fudepan never guesses it.
   */
  missingHospital: { name: string | null; askPerson: PersonId; filledBy: PersonId | null } | null;
  /**
   * The task is about going with her, so someone must have taken on the
   * companion role before it can be confirmed or done. Only a person's own claim
   * fills it; nothing assigns it.
   */
  requiresCompanion: boolean;
};

export type ExampleState = { tasks: readonly ExampleTask[] };

/** Refusals that only exist in the example. Everything else is a rule-module code. */
export type ClinicNameProblem = "clinic_name_required" | "clinic_name_too_long";
export type ExampleOnlyRefusal =
  | ClinicNameProblem
  | "clinic_unknown"
  | "companion_missing"
  | "already_confirmed"
  | "no_target"
  | "thanks_not_allowed";
export type ExampleRefusal = RefusalCode | ExampleOnlyRefusal;

export type ExampleResult = { ok: true; state: ExampleState } | { ok: false; code: ExampleRefusal };

const EXAMPLE_ONLY: readonly string[] = [
  "clinic_name_required",
  "clinic_name_too_long",
  "clinic_unknown",
  "companion_missing",
  "already_confirmed",
  "no_target",
  "thanks_not_allowed",
] satisfies readonly ExampleOnlyRefusal[];

export function isExampleOnlyRefusal(code: ExampleRefusal): code is ExampleOnlyRefusal {
  return EXAMPLE_ONLY.includes(code);
}

const noHolders = { owner: null, driver: null, companion: null } satisfies ExampleTask["holders"];

/**
 * The note as read, before anyone presses anything. Nothing is done yet. Misa
 * has the insurance card. Kenta owns the visit and drives. The clinic is
 * unknown: the note says to ask Misa, so she is the person to ask, not the owner.
 * The clinic task, the companion slot, and the glasses are free to take.
 */
export function initialExample(): ExampleState {
  return {
    tasks: [
      {
        id: "card",
        careCategory: "document",
        riskLevel: "medium",
        approvalRequired: false,
        approvalState: "not_required",
        claimRole: "owner",
        holders: { ...noHolders, owner: "misa" },
        status: "in_progress",
        noteLine: 2,
        askPerson: null,
        evidenceRequired: [],
        missingHospital: null,
        requiresCompanion: false,
      },
      {
        id: "clinic",
        // A question inside the family: no approval needed. Medium, because the visit waits on it.
        careCategory: "communication",
        riskLevel: "medium",
        approvalRequired: false,
        approvalState: "not_required",
        claimRole: "owner",
        holders: { ...noHolders },
        status: "open",
        noteLine: 1,
        askPerson: "misa",
        evidenceRequired: [CLINIC_EVIDENCE],
        missingHospital: null,
        requiresCompanion: false,
      },
      {
        id: "visit",
        careCategory: "appointment",
        riskLevel: "high",
        approvalRequired: true,
        approvalState: "pending",
        claimRole: "companion",
        holders: { ...noHolders, owner: "kenta", driver: "kenta" },
        status: "in_progress",
        noteLine: 0,
        askPerson: null,
        evidenceRequired: [],
        missingHospital: { name: null, askPerson: "misa", filledBy: null },
        requiresCompanion: true,
      },
      {
        id: "glasses",
        careCategory: "household",
        riskLevel: "low",
        approvalRequired: false,
        approvalState: "not_required",
        claimRole: "owner",
        holders: { ...noHolders },
        status: "open",
        noteLine: 3,
        askPerson: null,
        evidenceRequired: [],
        missingHospital: null,
        requiresCompanion: false,
      },
    ],
  };
}

const LEGACY_STATUS: Record<TaskStatus, string> = {
  open: "pending_review",
  in_progress: "in_progress",
  completed: "completed",
};

function toSnapshot(task: ExampleTask, evidenceAttached: string[] = []): PartSnapshot {
  return {
    id: task.id,
    householdId: HOUSEHOLD,
    careCategory: task.careCategory,
    riskLevel: task.riskLevel,
    approvalRequired: task.approvalRequired,
    storedApprovalState: task.approvalState,
    legacyStatus: LEGACY_STATUS[task.status],
    ownerId: task.holders.owner,
    driverId: task.holders.driver,
    companionId: task.holders.companion,
    backupOwnerId: null,
    taskDue: null,
    respondBy: null,
    evidenceRequired: [...task.evidenceRequired],
    evidenceAttached,
    planVersion: 0,
    rejectedAtPlanVersion: null,
  };
}

function member(person: PersonId): MemberSnapshot {
  const role = PEOPLE.find((p) => p.id === person)?.role ?? "family_member";
  return { memberId: person, householdId: HOUSEHOLD, role, isActive: true };
}

function asPerson(id: string | null): PersonId | null {
  return PEOPLE.some((p) => p.id === id) ? (id as PersonId) : null;
}

function statusFor(holders: ExampleTask["holders"]): TaskStatus {
  return Object.values(holders).some((h) => h !== null) ? "in_progress" : "open";
}

/** Copies holders and approval back from a snapshot the rules returned. */
function fromSnapshot(task: ExampleTask, snap: PartSnapshot): ExampleTask {
  const holders = {
    owner: asPerson(snap.ownerId),
    driver: asPerson(snap.driverId),
    companion: asPerson(snap.companionId),
  };
  return { ...task, approvalState: effectiveApprovalState(snap), holders, status: statusFor(holders) };
}

function replaceTask(state: ExampleState, ...next: ExampleTask[]): ExampleState {
  return { tasks: state.tasks.map((t) => next.find((n) => n.id === t.id) ?? t) };
}

export function findTask(state: ExampleState, id: TaskId): ExampleTask | undefined {
  return state.tasks.find((t) => t.id === id);
}

/** The person who has taken on this task's claimable role, or null ("No one yet"). */
export function holderOf(task: ExampleTask): PersonId | null {
  return task.holders[task.claimRole];
}

/** True when `person` holds any role on the task. */
export function isHelper(task: ExampleTask, person: PersonId): boolean {
  return Object.values(task.holders).includes(person);
}

/** True while the clinic for this task is still unknown. Only the visit has one. */
export function clinicUnknown(task: ExampleTask): boolean {
  return task.missingHospital !== null && task.missingHospital.name === null;
}

/** True while the visit still has nobody going along with her. */
export function companionMissing(task: ExampleTask): boolean {
  return task.requiresCompanion && task.holders.companion === null;
}

/** True when `person` may take this task on now. Drives the "引き受ける" button and the drop targets. */
export function isAvailable(task: ExampleTask, person: PersonId): boolean {
  return decideClaim(toSnapshot(task), member(person), task.claimRole).ok;
}

/** The tasks `person` could take on now: the drop targets highlighted while dragging their face. */
export function dropTargets(state: ExampleState, person: PersonId): TaskId[] {
  return state.tasks.filter((t) => isAvailable(t, person)).map((t) => t.id);
}

/** Approval is still needed. Stays true after a claim, because only the primary caregiver can confirm. */
export function awaitsConfirmation(task: ExampleTask): boolean {
  return task.approvalRequired && task.approvalState === "pending";
}

export function isConfirmed(task: ExampleTask): boolean {
  return task.approvalRequired && task.approvalState === "approved";
}

/** True when `person` may confirm this task now: the primary caregiver, once the clinic is known. */
export function canConfirm(task: ExampleTask, person: PersonId): boolean {
  if (!awaitsConfirmation(task) || clinicUnknown(task) || companionMissing(task)) return false;
  return decideApproval(toSnapshot(task), member(person), ACTIVE_PRIMARY_COUNT, "approve").ok;
}

/** True when `person` may mark this task as done now. The clinic task is done by saving a name instead. */
export function canComplete(task: ExampleTask, person: PersonId): boolean {
  if (task.id === "clinic") return false;
  if (clinicUnknown(task) || companionMissing(task)) return false;
  const d = decideCompletion(toSnapshot(task), member(person));
  return d.ok && d.value.outcome === "completed";
}

/** True when `person` owns the clinic task and saving a clinic name would complete it. */
export function canFillClinic(task: ExampleTask, person: PersonId): boolean {
  if (!task.evidenceRequired.includes(CLINIC_EVIDENCE)) return false;
  const d = decideCompletion(toSnapshot(task, [CLINIC_EVIDENCE]), member(person));
  return d.ok && d.value.outcome === "completed";
}

/** True when `person` holds the task's claimable role and may give it back. */
export function canRelease(task: ExampleTask, person: PersonId): boolean {
  if (task.status === "completed" || holderOf(task) !== person) return false;
  return decideRelease(toSnapshot(task), member(person), task.claimRole, new Date(0)).ok;
}

/** `person` takes the task on. The 「引き受ける」 button and the avatar drop both end here. */
export function claim(state: ExampleState, id: TaskId, person: PersonId): ExampleResult {
  const task = findTask(state, id);
  if (!task) return { ok: false, code: "part_not_found" };
  const d = decideClaim(toSnapshot(task), member(person), task.claimRole);
  if (!d.ok) return d;
  return { ok: true, state: replaceTask(state, fromSnapshot(task, d.value)) };
}

/**
 * A face dropped on the page. `target` is the task under the pointer, or null
 * when the face was let go anywhere else. A task is claimed only through `claim`,
 * so a drop can never do more than the button.
 */
export function dropClaim(state: ExampleState, target: TaskId | null, person: PersonId): ExampleResult {
  if (target === null) return { ok: false, code: "no_target" };
  return claim(state, target, person);
}

export function release(state: ExampleState, id: TaskId, person: PersonId): ExampleResult {
  const task = findTask(state, id);
  if (!task) return { ok: false, code: "part_not_found" };
  const d = decideRelease(toSnapshot(task), member(person), task.claimRole, new Date(0));
  if (!d.ok) return d;
  return { ok: true, state: replaceTask(state, fromSnapshot(task, d.value)) };
}

/** The primary caregiver confirms a high-risk task. This never completes it. */
export function confirm(state: ExampleState, id: TaskId, person: PersonId): ExampleResult {
  const task = findTask(state, id);
  if (!task) return { ok: false, code: "part_not_found" };
  const d = decideApproval(toSnapshot(task), member(person), ACTIVE_PRIMARY_COUNT, "approve");
  if (!d.ok) return d;
  if (task.approvalState === "approved") return { ok: false, code: "already_confirmed" };
  if (clinicUnknown(task)) return { ok: false, code: "clinic_unknown" };
  if (companionMissing(task)) return { ok: false, code: "companion_missing" };
  return { ok: true, state: replaceTask(state, { ...task, approvalState: d.value.state }) };
}

export function complete(state: ExampleState, id: TaskId, person: PersonId): ExampleResult {
  const task = findTask(state, id);
  if (!task) return { ok: false, code: "part_not_found" };
  const d = decideCompletion(toSnapshot(task), member(person));
  if (!d.ok) return d;
  if (d.value.outcome !== "completed") return { ok: false, code: "clinic_name_required" };
  // The clinic task has one finish action: saveClinic with a valid name.
  if (id === "clinic") return { ok: false, code: "clinic_name_required" };
  if (clinicUnknown(task)) return { ok: false, code: "clinic_unknown" };
  if (companionMissing(task)) return { ok: false, code: "companion_missing" };
  return { ok: true, state: replaceTask(state, { ...task, status: "completed" }) };
}

const clinicNameSchema = z.string().trim().min(1).max(APPOINTMENT_LOCATION_MAX);

/** Checks a typed clinic name: not blank, at most APPOINTMENT_LOCATION_MAX characters. */
export function parseClinicName(raw: string): { ok: true; name: string } | { ok: false; code: ClinicNameProblem } {
  const parsed = clinicNameSchema.safeParse(raw);
  if (parsed.success) return { ok: true, name: parsed.data };
  const tooLong = parsed.error.issues.some((issue) => issue.code === "too_big");
  return { ok: false, code: tooLong ? "clinic_name_too_long" : "clinic_name_required" };
}

/**
 * The owner of the clinic task saves the clinic name they were told. This
 * completes the clinic task and fills in the visit's missing clinic. It does
 * not confirm the visit: a changed key fact never approves anything, and an
 * already confirmed visit goes back to awaiting confirmation.
 */
export function saveClinic(state: ExampleState, raw: string, person: PersonId): ExampleResult {
  const task = findTask(state, "clinic");
  const visit = findTask(state, "visit");
  if (!task || !visit?.missingHospital) return { ok: false, code: "part_not_found" };
  const d = decideCompletion(toSnapshot(task, [CLINIC_EVIDENCE]), member(person));
  if (!d.ok) return d;
  if (d.value.outcome !== "completed") return { ok: false, code: "clinic_name_required" };
  const parsed = parseClinicName(raw);
  if (!parsed.ok) return parsed;
  const approvalState = isHighRiskPart(visit)
    ? nextApprovalStateOnChange(visit.approvalState, "key_fact")
    : visit.approvalState;
  return {
    ok: true,
    state: replaceTask(
      state,
      { ...task, status: "completed" },
      { ...visit, approvalState, missingHospital: { ...visit.missingHospital, name: parsed.name, filledBy: person } },
    ),
  };
}

export function progress(state: ExampleState): { done: number; total: number } {
  return { done: state.tasks.filter((t) => t.status === "completed").length, total: state.tasks.length };
}

/** True only when `next` has more completed tasks than `prev`. Claims, confirmations, drops, and resets are not. */
export function isNewCompletion(prev: ExampleState, next: ExampleState): boolean {
  return progress(next).done > progress(prev).done;
}

/** Which of Grandma's five photos to show: 0 before anything is done, then one per completed task. */
export type GrandmaPhotoIndex = 0 | 1 | 2 | 3 | 4;

export function grandmaPhotoIndex(done: number): GrandmaPhotoIndex {
  return Math.max(0, Math.min(4, Math.floor(done))) as GrandmaPhotoIndex;
}

/**
 * What a task is waiting for, so the page can say who acts next.
 * `clinic`: the clinic name is needed first. `confirm`: the primary caregiver
 * has to confirm. `owner`: the owner can finish it. Null when it is done or
 * nobody has taken it on.
 */
export type Waiting =
  | { kind: "clinic" }
  | { kind: "companion" }
  | { kind: "confirm"; by: PersonId }
  | { kind: "owner"; by: PersonId }
  | null;

export function waitingOn(task: ExampleTask): Waiting {
  if (task.status === "completed") return null;
  if (clinicUnknown(task)) return { kind: "clinic" };
  if (companionMissing(task)) return { kind: "companion" };
  if (awaitsConfirmation(task)) return { kind: "confirm", by: PRIMARY };
  return task.holders.owner ? { kind: "owner", by: task.holders.owner } : null;
}

/** True for tasks whose 「完了にする」 is always shown, disabled with a reason until it can be pressed: unfinished tasks that need approval (the visit). */
export function alwaysShowsComplete(task: ExampleTask): boolean {
  return task.approvalRequired && task.status !== "completed";
}

/**
 * Why `person` cannot mark this task as done yet, or null when `canComplete`
 * passes (or the task is finished). `canComplete` stays the only gate; this only
 * names the first unmet step: the clinic name and the companion, then the
 * primary caregiver's confirmation, then the owner.
 */
export type CompletionBlock =
  /** The clinic name, the companion, or both are still missing. */
  | { kind: "missing"; clinic: boolean; companion: boolean }
  | { kind: "confirm"; by: PersonId }
  /** `by` is null only if nobody owns the task. */
  | { kind: "owner"; by: PersonId | null };

export function completionBlock(task: ExampleTask, person: PersonId): CompletionBlock | null {
  if (task.status === "completed" || canComplete(task, person)) return null;
  if (clinicUnknown(task) || companionMissing(task)) {
    return { kind: "missing", clinic: clinicUnknown(task), companion: companionMissing(task) };
  }
  if (awaitsConfirmation(task)) return { kind: "confirm", by: PRIMARY };
  return { kind: "owner", by: task.holders.owner };
}

/**
 * Thank-you stickers. Free, local to this page, and kept apart from the tasks:
 * sending, changing, or removing one never touches progress, owners, or approval.
 * Each person can leave one sticker on each finished task someone else owns,
 * addressed to that task's owner.
 */
export const STICKERS = ["helped", "ride", "hardWork"] as const;
export type StickerId = (typeof STICKERS)[number];
export type Thanks = { task: TaskId; from: PersonId; to: PersonId; sticker: StickerId };
export type ThanksList = readonly Thanks[];
export type ThanksResult = { ok: true; thanks: ThanksList } | { ok: false; code: "thanks_not_allowed" };

/** Who `from` can thank on this task: its owner, once it is done, if that is someone else. */
export function thanksRecipient(task: ExampleTask, from: PersonId): PersonId | null {
  if (task.status !== "completed") return null;
  const owner = task.holders.owner;
  return owner && owner !== from ? owner : null;
}

/** The stickers on one task, in the order they were first sent. */
export function thanksOn(list: ThanksList, task: TaskId): Thanks[] {
  return list.filter((t) => t.task === task);
}

/** The sticker `from` has left on this task, if any. */
export function sentThanks(list: ThanksList, task: TaskId, from: PersonId): Thanks | null {
  return list.find((t) => t.task === task && t.from === from) ?? null;
}

/** Sends a sticker to the task's owner, or changes the one `from` already sent. Returns only the new list. */
export function sendThanks(
  state: ExampleState,
  list: ThanksList,
  taskId: TaskId,
  from: PersonId,
  sticker: StickerId,
): ThanksResult {
  const task = findTask(state, taskId);
  const to = task ? thanksRecipient(task, from) : null;
  if (!to || !STICKERS.includes(sticker)) return { ok: false, code: "thanks_not_allowed" };
  const next: Thanks = { task: taskId, from, to, sticker };
  const i = list.findIndex((t) => t.task === taskId && t.from === from);
  return { ok: true, thanks: i < 0 ? [...list, next] : list.map((t, j) => (j === i ? next : t)) };
}

/** Removes the sticker `from` left on this task. Nothing else changes. */
export function removeThanks(list: ThanksList, taskId: TaskId, from: PersonId): ThanksList {
  return list.filter((t) => !(t.task === taskId && t.from === from));
}

export function allDone(state: ExampleState): boolean {
  const { done, total } = progress(state);
  return done === total;
}

/** One thing a person really did in this run. */
export type ContributionItem =
  | { kind: "finished"; task: TaskId }
  | { kind: "drove" }
  | { kind: "went_along" }
  | { kind: "confirmed" };
export type Contribution = { person: PersonId; items: ContributionItem[] };

/**
 * What each person did, read from the finished tasks: the tasks they finished as
 * owner, driving or going along on the visit, and Misa's confirmation of it (only
 * the primary caregiver can confirm, so an approved, finished visit means she did).
 * Someone who did nothing is left out; nothing is made up.
 */
export function contributions(state: ExampleState): Contribution[] {
  const visit = findTask(state, "visit");
  const visitDone = visit?.status === "completed";
  return PEOPLE.map(({ id }) => {
    const items: ContributionItem[] = state.tasks
      .filter((t) => t.status === "completed" && t.holders.owner === id)
      .map((t) => ({ kind: "finished", task: t.id }));
    if (visit && visitDone) {
      if (visit.holders.driver === id) items.push({ kind: "drove" });
      if (visit.holders.companion === id) items.push({ kind: "went_along" });
      if (id === PRIMARY && isConfirmed(visit)) items.push({ kind: "confirmed" });
    }
    return { person: id, items };
  }).filter((c) => c.items.length > 0);
}

/**
 * One row of the 「今週のありがとう」 board. `done` counts the finished tasks this
 * person owns; nothing else counts (claims, confirmation, switching person, stickers).
 * `rank` is shared on equal counts (1, 2, 2), and `tied` says so. `best` marks
 * each first place once all tasks are done.
 */
export type BoardRow = { person: PersonId; done: number; rank: number; tied: boolean; best: boolean };

/**
 * The board, read from the current tasks: people with at least one finished task,
 * most first, equal counts in family order. Empty until a task is done, so
 * "Start over" empties it too.
 */
export function leaderboard(state: ExampleState): BoardRow[] {
  const finished = allDone(state);
  const counts = PEOPLE.map(({ id }) => ({
    person: id,
    done: state.tasks.filter((t) => t.status === "completed" && t.holders.owner === id).length,
  })).filter((r) => r.done > 0);
  // Stable sort, so equal counts keep family order.
  counts.sort((a, b) => b.done - a.done);
  return counts.map((r) => {
    const rank = 1 + counts.filter((o) => o.done > r.done).length;
    const tied = counts.some((o) => o.person !== r.person && o.done === r.done);
    return { ...r, rank, tied, best: finished && rank === 1 };
  });
}
