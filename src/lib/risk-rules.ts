import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/ocr/confidence";
import type { RiskLevel, TaskCategory } from "@/lib/schemas/task";
import { HIGH_RISK_CATEGORIES } from "@/lib/schemas/task";

/**
 * Category mapping and risk classification (design.md "Risk rules").
 * Risk is computed here, never by the LLM. Keywords are English and Japanese.
 */

const KEYWORDS: Record<"medication" | "payment" | "appointment" | "pickup" | "routine", string[]> =
  {
    medication: [
      "medic(?:ation|ine)s?",
      "pills?",
      "tablets?",
      "prescription",
      "pharmac(?:y|ist)",
      "dosage",
      "dose",
      "insulin",
      "refill",
      "薬",
      "処方",
      "服薬",
      "錠",
      "点眼",
      "注射",
    ],
    payment: [
      "pay(?:ment|ments|ing)?",
      "bank transfer",
      "wire transfer",
      "transfer (?:money|funds)",
      "invoices?",
      "bills?",
      "credit cards?",
      "debit",
      "rent",
      "tax(?:es)?",
      "utilit(?:y|ies)",
      "fees?",
      "gift ?cards?",
      "振込",
      "振り込",
      "支払",
      "払い",
      "払う",
      "請求",
      "納付",
      "クレジット",
      "カード",
      "送金",
      "家賃",
      "税金",
      "料金",
      "代金",
      "引き落とし",
      "ギフトカード",
      "プリペイド",
    ],
    appointment: [
      "appointments?",
      "reservations?",
      "reserve",
      "booking",
      "check-?ups?",
      "hospital",
      "clinic",
      "doctor",
      "dentist",
      "government",
      "city hall",
      "ward office",
      "passport",
      "visa",
      "license renewal",
      "予約",
      "診察",
      "診療",
      "通院",
      "病院",
      "医院",
      "クリニック",
      "歯科",
      "医者",
      "検診",
      "健診",
      "役所",
      "手続",
      "申請",
      "届出",
      "マイナンバー",
    ],
    pickup: [
      "pick(?:ing)?[- ]?up",
      "drop[- ]?off",
      "ride",
      "drive",
      "taxi",
      "trains?",
      "bus",
      "flights?",
      "airport",
      "travel",
      "trip",
      "transport(?:ation)?",
      "迎え",
      "送迎",
      "送り",
      "タクシー",
      "電車",
      "バス",
      "飛行機",
      "空港",
      "旅行",
      "出張",
      "移動",
    ],
    routine: [
      "shopping",
      "grocer(?:y|ies)",
      "buy",
      "laundry",
      "clean(?:ing)?",
      "trash",
      "garbage",
      "water the plants",
      "vacuum",
      "dishes",
      "買い物",
      "買う",
      "買って",
      "掃除",
      "洗濯",
      "ゴミ",
      "水やり",
    ],
  };

function compile(words: string[]): RegExp {
  const parts = words.map((w) => (/^[\x20-\x7e]+$/.test(w) ? `\\b${w}\\b` : w));
  return new RegExp(parts.join("|"), "iu");
}

const PATTERNS = {
  medication: compile(KEYWORDS.medication),
  payment: compile(KEYWORDS.payment),
  appointment: compile(KEYWORDS.appointment),
  pickup: compile(KEYWORDS.pickup),
  routine: compile(KEYWORDS.routine),
};

/** Precedence when several categories match: the first listed wins. */
const PRECEDENCE = ["medication", "payment", "appointment", "pickup"] as const;

export function hasHighRiskKeyword(text: string): boolean {
  return PRECEDENCE.some((c) => PATTERNS[c].test(text));
}

export interface CategoryMapping {
  category: TaskCategory;
  /** True when keyword rules replaced the model's category. */
  adjusted: boolean;
}

/** Keyword rules win over the model's category. With no keyword match the model's category stands. */
export function mapCategory(text: string, modelCategory: TaskCategory): CategoryMapping {
  for (const c of PRECEDENCE) {
    if (PATTERNS[c].test(text)) return { category: c, adjusted: modelCategory !== c };
  }
  if (PATTERNS.routine.test(text) && modelCategory === "other") {
    return { category: "reminder", adjusted: true };
  }
  return { category: modelCategory, adjusted: false };
}

export type RiskReason =
  | "high_risk_category"
  | "high_risk_keyword"
  | "low_confidence"
  | "unknown_category"
  | "routine_task";

export interface RiskAssessment {
  level: RiskLevel;
  reasons: RiskReason[];
}

/**
 * `confidence`: a number for AI extractions, `null` when the AI gave none (treated as low), or
 * "manual" when a person typed the task without AI involvement.
 */
export function classifyRisk(input: {
  category: TaskCategory;
  text: string;
  confidence: number | null | "manual";
}): RiskAssessment {
  const reasons: RiskReason[] = [];
  if (HIGH_RISK_CATEGORIES.includes(input.category)) reasons.push("high_risk_category");
  if (hasHighRiskKeyword(input.text)) reasons.push("high_risk_keyword");
  if (reasons.length > 0) return { level: "high", reasons };

  const lowConfidence =
    input.confidence !== "manual" &&
    (input.confidence === null || input.confidence < LOW_CONFIDENCE_THRESHOLD);
  if (lowConfidence) return { level: "medium", reasons: ["low_confidence"] };
  if (input.category === "reminder") return { level: "low", reasons: ["routine_task"] };
  return { level: "medium", reasons: ["unknown_category"] };
}

const URGENCY = compile([
  "urgent(?:ly)?",
  "immediately",
  "right away",
  "asap",
  "today only",
  "last chance",
  "act now",
  "至急",
  "今すぐ",
  "すぐに",
  "今日中",
  "緊急",
  "ただちに",
]);
const FRAUD_SPECIFIC = compile([
  "gift ?cards?",
  "bitcoin",
  "crypto(?:currency)?",
  "keep (?:this )?secret",
  "don'?t tell",
  "ギフトカード",
  "プリペイド",
  "仮想通貨",
  "電子マネー",
  "誰にも言わ",
]);

/** Heuristic caution for possible scams (safety policy item 9). Not a verdict. */
export function detectCautions(text: string): { possibleFraud: boolean } {
  const possibleFraud =
    FRAUD_SPECIFIC.test(text) || (URGENCY.test(text) && PATTERNS.payment.test(text));
  return { possibleFraud };
}
