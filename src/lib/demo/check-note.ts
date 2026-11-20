import { classifyRisk, detectCautions, mapCategory } from "@/lib/risk-rules";
import { maskSensitive, type SensitiveKind } from "@/lib/safety/mask-sensitive";
import type { RiskLevel, TaskCategory } from "@/lib/schemas/task";

/**
 * The landing-page sandbox. Runs Fudepan's real safety rules (masking, category, risk, scam
 * caution) on text a visitor types. Pure and synchronous: nothing is sent or saved.
 */

export const MAX_SANDBOX_LENGTH = 500;

export type NextStep = "approval" | "look" | "confirm";

export type NoteCheck =
  | { empty: true }
  | {
      empty: false;
      masked: string;
      maskedKinds: SensitiveKind[];
      category: TaskCategory;
      risk: RiskLevel;
      possibleFraud: boolean;
      nextStep: NextStep;
    };

export const NEXT_STEP_TEXT: Record<NextStep, string> = {
  approval: "Waits for a caregiver or coordinator to approve it.",
  look: "A family member takes a look, then a caregiver approves it.",
  confirm: "A caregiver can confirm it directly.",
};

export function checkNote(input: string): NoteCheck {
  const text = input.slice(0, MAX_SANDBOX_LENGTH);
  if (!text.trim()) return { empty: true };

  const { text: masked, kinds } = maskSensitive(text);
  // Rules run on the masked text, as they do in the app before anything is stored.
  const { category } = mapCategory(masked, "other");
  const { level } = classifyRisk({ category, text: masked, confidence: "manual" });
  const possibleFraud = detectCautions(masked).possibleFraud;
  const nextStep: NextStep =
    level === "high" || possibleFraud ? "approval" : level === "medium" ? "look" : "confirm";

  return {
    empty: false,
    masked,
    maskedKinds: kinds,
    category,
    risk: level,
    possibleFraud,
    nextStep,
  };
}
