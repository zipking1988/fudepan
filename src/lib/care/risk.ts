export const RISK_LEVELS = ["low", "medium", "high"] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Plain-language risk labels from .kiro/steering/accessibility.md.
 * Risk is always shown as text, never by color alone.
 */
export const RISK_LABELS: Record<RiskLevel, string> = {
  low: "Low priority",
  medium: "Needs attention",
  high: "Requires confirmation",
};
