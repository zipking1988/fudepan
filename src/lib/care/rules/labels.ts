/**
 * Label keys for risk and approval (family-shared-care design, "Labels").
 * Pure: returns message keys, never display text. Risk and approval are
 * separate labels. "Requires confirmation" is an approval label only and is
 * returned only while approval is pending.
 */
import { en } from "@/lib/i18n/en";
import type { RiskLevel } from "@/lib/care/risk";
import { COMPLETED_LABEL_KEY } from "@/lib/care/rules/defaults";
import type { ApprovalState, ProgressStatus } from "@/lib/care/rules/types";

export type RiskLabelKey = "lowPriority" | "needsAttention" | "highRisk";
export type ApprovalLabelKey = "requiresConfirmation" | "confirmed" | "notApproved" | typeof COMPLETED_LABEL_KEY;

const RISK_KEYS: Record<RiskLevel, RiskLabelKey> = {
  low: "lowPriority",
  medium: "needsAttention",
  high: "highRisk",
};

export function riskLabelKey(riskLevel: RiskLevel): RiskLabelKey {
  return RISK_KEYS[riskLevel];
}

/**
 * Approval or completion label for a Part, or null when there is none to show.
 * Completed is checked first, so a finished Part never shows pending-approval text.
 */
export function approvalLabelKey(part: {
  progressStatus: ProgressStatus | string;
  approvalState: ApprovalState;
}): ApprovalLabelKey | null {
  if (part.progressStatus === "completed") return COMPLETED_LABEL_KEY;
  switch (part.approvalState) {
    case "pending":
      return "requiresConfirmation";
    case "approved":
      return "confirmed";
    case "rejected":
      return "notApproved";
    default:
      return null;
  }
}

/**
 * English text for the keys, read from the dictionary (`src/lib/i18n/en.ts`).
 * Every label is words, so nothing relies on colour alone.
 */
export const LABEL_TEXT_EN: Record<RiskLabelKey | ApprovalLabelKey, string> = {
  lowPriority: en["label.lowPriority"],
  needsAttention: en["label.needsAttention"],
  highRisk: en["label.highRisk"],
  requiresConfirmation: en["label.requiresConfirmation"],
  confirmed: en["label.confirmed"],
  notApproved: en["label.notApproved"],
  done: en["label.done"],
};

/** Dictionary key for a label key, for translators in other languages. */
export function labelMessageKey(key: RiskLabelKey | ApprovalLabelKey): `label.${RiskLabelKey | ApprovalLabelKey}` {
  return `label.${key}`;
}
