import { classifyRisk, detectCautions, mapCategory } from "@/lib/risk-rules";
import type { RiskLevel, TaskCategory } from "@/lib/schemas/task";
import { DEMO_NOTE_TEXT } from "./fixtures";

/**
 * Fictional content for the public landing page. Nothing here is saved or sent, and no AI service
 * produced it. Category, risk and the scam flag are not written by hand: `assess` runs Fudepan's
 * real rules on the note text, exactly as the app does for a note a person wrote.
 */

export interface Assessment {
  category: TaskCategory;
  risk: RiskLevel;
  possibleFraud: boolean;
}

export function assess(text: string): Assessment {
  const { category } = mapCategory(text, "other");
  const { level } = classifyRisk({ category, text, confidence: "manual" });
  return { category, risk: level, possibleFraud: detectCautions(text).possibleFraud };
}

/** The medication note used in the main scene (same text as the /demo example). */
export const MEDICINE_TEXT = DEMO_NOTE_TEXT;

export const SCAM_LINES = [
  "警察から電話。",
  "キャッシュカードを",
  "封筒に入れて渡す。",
  "今日中。",
  "誰にも言わないで。",
] as const;
export const SCAM_TEXT = SCAM_LINES.join("\n");

/**
 * The words in the scam note that the rules react to (`detectCautions`): secrecy on its own, or
 * urgency together with money. A unit test checks each claim against the real rule.
 */
export const SCAM_SIGNALS = [
  { text: "キャッシュカード", kind: "money", label: "Asks for a cash card" },
  { text: "今日中", kind: "urgency", label: "Rushes: “by today”" },
  { text: "誰にも言わないで", kind: "secrecy", label: "Asks to keep it secret" },
] as const;

/** Sourced numbers. Each figure was checked against its primary source. */
export const STATS = {
  scamLosses: {
    figure: "¥142.3B",
    text: "lost to phone and impersonation scams in Japan in 2025, nearly double 2024. Fake-police scams caused ¥100.5B of it.",
    source: "National Police Agency, 2025 final figures",
    href: "https://www.npa.go.jp/publications/statistics/sousa/sagi.html",
  },
  intervention: {
    figure: "51%",
    text: "of scam targets who said a bank teller, cashier or other third party stepped in avoided losing money.",
    source: "FINRA Foundation, BBB Institute & Stanford Center on Longevity, 2019",
    href: "https://www.finrafoundation.org/sites/finrafoundation/files/exposed-to-scams-what-separates-victims-from-non-victims_0_0.pdf",
  },
  livingAlone: {
    figure: "3 in 10",
    text: "Japanese households that include someone aged 65+ are a person living alone. About as many more are a couple on their own.",
    source: "Cabinet Office, Annual Report on the Ageing Society 2024",
    href: "https://www8.cao.go.jp/kourei/whitepaper/w-2024/html/zenbun/s1_1_3.html",
  },
} as const;

export type StatKey = keyof typeof STATS;
