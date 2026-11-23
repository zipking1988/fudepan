import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { SessionUser } from "@/lib/auth/session";
import { CARE_CATEGORIES } from "@/lib/ai/schema";
import { isHouseholdRole } from "@/lib/households/membership";
import type { Logger } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

import { translateOwnerAssignment, type OwnerAssignmentOperation } from "./owner-assignment";
import type { PartActionFailure, PartActionResult, PartActionService } from "./part-actions";
import { RISK_LEVELS } from "./risk";
import type { CareRequestSnapshot } from "./rules/requests";
import {
  evidenceStillNeededMessage,
  oldActionMessage,
  OLD_EVIDENCE_TEXT_INVALID,
  OLD_OUTCOME_MESSAGES,
} from "./rules/messages-en";
import { refusalMessageKey } from "./rules/refusals";
import type { ApprovalState, ConfirmedTime, MemberSnapshot, PartSnapshot } from "./rules/types";

type Client = SupabaseClient<Database>;

/**
 * The old `/care` actions, rerouted through the same guarded service as the new
 * flow (family-shared-care design, "Rerouting the old /care actions"; Requirements
 * 9.13, 11.8, 15.3, 18.5, 21.1 to 21.6).
 *
 * Nothing here writes `care_steps` or `audit_events`. Reads use the signed-in
 * person's row-level-security client; every change goes through the service,
 * whose SQL functions enforce the Action_Guard. The functions keep the old
 * `(input: unknown) => Promise<ActionResult>` shape, plus an optional plain
 * `message` the old page shows on success.
 */

export type LegacyResult = { ok: true; message?: string } | { ok: false; error: string };

export type LegacyCareActionDeps = {
  getSession: () => Promise<{ supabase: Client; user: SessionUser | null }>;
  service: PartActionService;
  /** Revalidates the old chain page and its timeline. */
  revalidateChain: (careChainId: string) => void;
  log: Logger;
  now?: () => Date;
};

const SIGNED_OUT = "refusal.signedOut" as const;

function fail(failure: Pick<PartActionFailure, "messageKey">): LegacyResult {
  return { ok: false, error: oldActionMessage(failure.messageKey) };
}

const stepOnly = z.object({ stepId: z.uuid() });

const assignInput = z.object({
  stepId: z.uuid(),
  ownerId: z.uuid().nullable(),
  backupOwnerId: z.uuid().nullable().optional(),
});

const evidenceInput = z.object({
  stepId: z.uuid(),
  text: z.string().trim().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Reads for assignStepOwner
// ---------------------------------------------------------------------------

type StepRow = {
  id: string;
  care_chain_id: string;
  care_category: string;
  risk_level: string;
  approval_required: boolean;
  approval_state: string | null;
  status: string;
  owner_id: string | null;
  driver_id: string | null;
  companion_id: string | null;
  backup_owner_id: string | null;
  task_due_at: string | null;
  task_due_timezone: string | null;
  task_due_provenance: string | null;
  respond_by_at: string | null;
  respond_by_timezone: string | null;
  respond_by_provenance: string | null;
  evidence_required: string[] | null;
  plan_version: number;
  rejected_at_plan_version: number | null;
  care_chains: { household_id: string } | { household_id: string }[] | null;
};

const STEP_COLUMNS =
  "id, care_chain_id, care_category, risk_level, approval_required, approval_state, status, " +
  "owner_id, driver_id, companion_id, backup_owner_id, " +
  "task_due_at, task_due_timezone, task_due_provenance, " +
  "respond_by_at, respond_by_timezone, respond_by_provenance, " +
  "evidence_required, plan_version, rejected_at_plan_version, care_chains ( household_id )";

function confirmedTime(
  at: string | null,
  timeZone: string | null,
  provenance: string | null,
): ConfirmedTime | null {
  if (at === null || timeZone === null) return null;
  if (provenance !== "human_confirmed" && provenance !== "model_suggested") return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return { at: date, timeZone, provenance };
}

function approvalStateOrNull(value: string | null): ApprovalState | null {
  return value === "not_required" ||
    value === "pending" ||
    value === "approved" ||
    value === "rejected"
    ? value
    : null;
}

type AssignmentContext = {
  careChainId: string;
  part: PartSnapshot;
  actor: MemberSnapshot;
  members: MemberSnapshot[];
  pending: CareRequestSnapshot[];
};

/** Reads the part, the household's members, and the Part's pending requests as the signed-in person. */
async function loadAssignmentContext(
  supabase: Client,
  userId: string,
  stepId: string,
): Promise<AssignmentContext | { code: "part_not_found" | "error" }> {
  const { data, error } = await supabase
    .from("care_steps")
    .select(STEP_COLUMNS)
    .eq("id", stepId)
    .maybeSingle();
  if (error) return { code: "error" };
  const step = data as unknown as StepRow | null;
  const chain = step
    ? Array.isArray(step.care_chains)
      ? step.care_chains[0]
      : step.care_chains
    : null;
  if (!step || !chain) return { code: "part_not_found" };

  const category = (CARE_CATEGORIES as readonly string[]).includes(step.care_category)
    ? (step.care_category as PartSnapshot["careCategory"])
    : null;
  const risk = (RISK_LEVELS as readonly string[]).includes(step.risk_level)
    ? (step.risk_level as PartSnapshot["riskLevel"])
    : null;
  if (category === null || risk === null) return { code: "error" };

  const householdId = chain.household_id;

  const [membersResult, requestsResult] = await Promise.all([
    supabase
      .from("household_members")
      .select("id, household_id, role, is_active, user_id")
      .eq("household_id", householdId),
    supabase
      .from("care_requests")
      .select(
        "id, care_step_id, household_id, kind, helper_role, from_member_id, to_member_id, status, expires_at",
      )
      .eq("care_step_id", stepId)
      .eq("status", "pending"),
  ]);
  if (membersResult.error || requestsResult.error) return { code: "error" };

  const members: MemberSnapshot[] = [];
  let actor: MemberSnapshot | null = null;
  for (const row of membersResult.data) {
    if (!isHouseholdRole(row.role)) continue;
    const snapshot: MemberSnapshot = {
      memberId: row.id,
      householdId: row.household_id,
      role: row.role,
      isActive: row.is_active,
    };
    members.push(snapshot);
    if (row.user_id === userId) actor = snapshot;
  }
  // Not a member of this household: the same answer as a missing Part (Requirement 14.2).
  if (!actor) return { code: "part_not_found" };

  const pending: CareRequestSnapshot[] = [];
  for (const row of requestsResult.data) {
    if (row.kind !== "assignment" && row.kind !== "handover" && row.kind !== "backup") continue;
    const helperRole =
      row.helper_role === "owner" || row.helper_role === "driver" || row.helper_role === "companion"
        ? row.helper_role
        : null;
    pending.push({
      id: row.id,
      careStepId: row.care_step_id,
      householdId: row.household_id,
      kind: row.kind,
      helperRole,
      requesterId: row.from_member_id,
      receiverId: row.to_member_id,
      status: "pending",
      expiresAt: new Date(row.expires_at),
    });
  }

  const part: PartSnapshot = {
    id: step.id,
    householdId,
    careCategory: category,
    riskLevel: risk,
    approvalRequired: step.approval_required,
    storedApprovalState: approvalStateOrNull(step.approval_state),
    legacyStatus: step.status,
    ownerId: step.owner_id,
    driverId: step.driver_id,
    companionId: step.companion_id,
    backupOwnerId: step.backup_owner_id,
    taskDue: confirmedTime(step.task_due_at, step.task_due_timezone, step.task_due_provenance),
    respondBy: confirmedTime(
      step.respond_by_at,
      step.respond_by_timezone,
      step.respond_by_provenance,
    ),
    evidenceRequired: step.evidence_required ?? [],
    evidenceAttached: [],
    planVersion: step.plan_version,
    rejectedAtPlanVersion: step.rejected_at_plan_version,
  };

  return { careChainId: step.care_chain_id, part, actor, members, pending };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function createLegacyCareActions(deps: LegacyCareActionDeps) {
  const { service, revalidateChain, log } = deps;
  const now = deps.now ?? (() => new Date());

  function safeRevalidate(careChainId: string): void {
    try {
      revalidateChain(careChainId);
    } catch {
      // A cache refresh must not turn a committed action into an error.
    }
  }

  async function approveStep(input: unknown): Promise<LegacyResult> {
    const parsed = stepOnly.safeParse(input);
    if (!parsed.success) return fail({ messageKey: "refusal.invalidInput" });

    const { user } = await deps.getSession();
    if (!user) return fail({ messageKey: SIGNED_OUT });

    const result = await service.decideApproval(user, {
      stepId: parsed.data.stepId,
      decision: "approve",
    });
    if (!result.ok) return fail(result);

    safeRevalidate(result.careChainId);
    return { ok: true, message: OLD_OUTCOME_MESSAGES.approved };
  }

  async function completeStep(input: unknown): Promise<LegacyResult> {
    const parsed = stepOnly.safeParse(input);
    if (!parsed.success) return fail({ messageKey: "refusal.invalidInput" });

    const { user } = await deps.getSession();
    if (!user) return fail({ messageKey: SIGNED_OUT });

    const result = await service.complete(user, { stepId: parsed.data.stepId });
    if (!result.ok) return fail(result);

    safeRevalidate(result.careChainId);
    // A committed 'evidence_required' result is not an error (Requirement 11.8): show it plainly.
    if (result.outcome === "evidence_required") {
      return { ok: true, message: evidenceStillNeededMessage(result.missing) };
    }
    return { ok: true, message: OLD_OUTCOME_MESSAGES.completed };
  }

  async function addTextEvidence(input: unknown): Promise<LegacyResult> {
    const parsed = evidenceInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: OLD_EVIDENCE_TEXT_INVALID };

    const { user } = await deps.getSession();
    if (!user) return fail({ messageKey: SIGNED_OUT });

    // The text goes to part_evidence only; the SQL function keeps it out of the audit payload (15.3).
    const result = await service.recordEvidence(user, {
      stepId: parsed.data.stepId,
      kind: "text",
      label: "Note",
      text: parsed.data.text,
    });
    if (!result.ok) {
      if (result.code === "invalid_input") return { ok: false, error: OLD_EVIDENCE_TEXT_INVALID };
      return fail(result);
    }

    safeRevalidate(result.careChainId);
    return { ok: true, message: OLD_OUTCOME_MESSAGES.evidenceSaved };
  }

  async function runOperation(
    user: SessionUser,
    stepId: string,
    op: OwnerAssignmentOperation,
  ): Promise<
    | { result: PartActionResult; message: string }
    | { refusedKey: "refusal.notAllowedBackupRequest" }
  > {
    switch (op.type) {
      case "claim_part":
        return {
          result: await service.claim(user, { stepId, role: op.role }),
          message: OLD_OUTCOME_MESSAGES.claimed,
        };
      case "release_part":
        return {
          result: await service.release(user, { stepId, role: op.role }),
          message: OLD_OUTCOME_MESSAGES.released,
        };
      case "request_assignment":
        return {
          result: await service.requestAssignment(user, { stepId, toMemberId: op.receiverId }),
          message: OLD_OUTCOME_MESSAGES.assignmentRequested,
        };
      case "request_handover":
        return {
          result: await service.requestHandover(user, {
            stepId,
            role: op.role,
            toMemberId: op.receiverId,
          }),
          message: OLD_OUTCOME_MESSAGES.handoverRequested,
        };
      case "volunteer_backup":
        return {
          result: await service.volunteerBackup(user, { stepId }),
          message: OLD_OUTCOME_MESSAGES.volunteered,
        };
      case "request_backup":
        return {
          result: await service.requestBackup(user, { stepId, toMemberId: op.receiverId }),
          message: OLD_OUTCOME_MESSAGES.backupRequested,
        };
      case "withdraw_backup":
        // No SQL function exists for this (D-6); never fall back to a direct write.
        return { refusedKey: "refusal.notAllowedBackupRequest" };
    }
  }

  async function assignStepOwner(input: unknown): Promise<LegacyResult> {
    const parsed = assignInput.safeParse(input);
    if (!parsed.success) return fail({ messageKey: "refusal.invalidInput" });

    const { supabase, user } = await deps.getSession();
    if (!user) return fail({ messageKey: SIGNED_OUT });

    const { stepId, ownerId, backupOwnerId } = parsed.data;

    const loaded = await loadAssignmentContext(supabase, user.id, stepId);
    if ("code" in loaded) {
      if (loaded.code === "error") {
        log("error", "care.assign_owner_failed", { stage: "load_context", user_id: user.id });
      }
      return fail({ messageKey: refusalMessageKey(loaded.code) });
    }

    const plan = translateOwnerAssignment(
      loaded.part,
      { stepId, ownerId, ...(backupOwnerId !== undefined && { backupOwnerId }) },
      loaded.actor,
      { members: loaded.members, pending: loaded.pending, now: now() },
    );
    if (!plan.ok) return fail({ messageKey: refusalMessageKey(plan.code) });

    if (plan.value.length === 0) {
      return { ok: true, message: OLD_OUTCOME_MESSAGES.nothingToChange };
    }

    const messages: string[] = [];
    for (const op of plan.value) {
      const ran = await runOperation(user, stepId, op);
      if ("refusedKey" in ran) {
        if (messages.length > 0) safeRevalidate(loaded.careChainId);
        return fail({ messageKey: ran.refusedKey });
      }
      if (!ran.result.ok) {
        // Earlier operations in this call are committed; show the page as it now is.
        if (messages.length > 0) safeRevalidate(loaded.careChainId);
        return fail(ran.result);
      }
      messages.push(ran.message);
    }

    safeRevalidate(loaded.careChainId);
    return { ok: true, message: messages.join(" ") };
  }

  return { approveStep, assignStepOwner, completeStep, addTextEvidence };
}

export type LegacyCareActions = ReturnType<typeof createLegacyCareActions>;
