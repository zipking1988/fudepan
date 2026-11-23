/**
 * Plain data types for the pure care rule module (family-shared-care design,
 * "Pure rule module"). No I/O, no server-only imports: safe for client code
 * and for Vitest in node.
 */
import type { CareCategory } from "@/lib/ai/schema";
import type { RiskLevel } from "@/lib/care/risk";
import type { RefusalCode } from "@/lib/care/rules/refusals";
import type { HouseholdRole } from "@/lib/households/membership";

export type HelperRole = "owner" | "driver" | "companion";

export type ApprovalState = "not_required" | "pending" | "approved" | "rejected";

export type ProgressStatus =
  | "pending_review"
  | "needs_clarification"
  | "in_progress"
  | "evidence_required"
  | "escalated"
  | "completed"
  | "failed"
  | "cancelled";

/** A time with its zone and whether a human confirmed it. */
export type ConfirmedTime = {
  at: Date;
  timeZone: string;
  provenance: "human_confirmed" | "model_suggested";
};

export type PartSnapshot = {
  id: string;
  householdId: string;
  careCategory: CareCategory;
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  storedApprovalState: ApprovalState | null;
  legacyStatus: string;
  ownerId: string | null;
  driverId: string | null;
  companionId: string | null;
  backupOwnerId: string | null;
  taskDue: ConfirmedTime | null;
  respondBy: ConfirmedTime | null;
  evidenceRequired: string[];
  evidenceAttached: string[];
  planVersion: number;
  rejectedAtPlanVersion: number | null;
};

export type MemberSnapshot = {
  memberId: string;
  householdId: string;
  role: HouseholdRole;
  isActive: boolean;
};

export type Decision<T> = { ok: true; value: T } | { ok: false; code: RefusalCode };
