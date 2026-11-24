/**
 * What a Part does not know yet, said as plain questions with the reason and the existing form
 * that answers it.
 *
 * Pure: no dictionary. Questions and reasons are dictionary keys; the only free text is the
 * question ai& stored for this Part, which the event page may show. Nothing here fills a gap:
 * an answer always comes from a family member through the existing save paths.
 */
import { isClosedPart } from "./dashboard";
import type { EventPart } from "./shared-care-event";

/** Which existing form answers the fact, or null when someone answers it by taking a role. */
export type FactForm = "answer" | "appointment" | "amount" | "deadline" | null;

export type UnknownFact = {
  key: string;
  /** `missing.question.*` key, or null when the stored ai& question is shown instead. */
  questionKey: string | null;
  aiQuestion: string | null;
  /** `missing.reason.*` key. */
  reasonKey: string;
  /** "Ask {name}" hint from the note. Never an owner. */
  personToAsk: string | null;
  form: FactForm;
  storedDetailId: string | null;
};

const APPOINTMENT_CODES = new Set(["which_clinic", "which_date", "which_time"]);

function formFor(code: string, storedDetailId: string | null): FactForm {
  if (storedDetailId !== null) return "answer";
  if (APPOINTMENT_CODES.has(code)) return "appointment";
  if (code === "which_amount") return "amount";
  if (code === "when_is_deadline") return "deadline";
  return null;
}

export function unknownFacts(part: EventPart): UnknownFact[] {
  if (isClosedPart(part)) return [];
  return part.missingDetails.map((d) => {
    const ai = d.questionCode === "ai_question" && d.aiQuestion ? d.aiQuestion : null;
    return {
      key: d.key,
      questionKey: ai ? null : `missing.question.${d.questionCode}`,
      aiQuestion: ai,
      reasonKey: d.reasonCode,
      personToAsk: d.personToAsk,
      form: formFor(d.questionCode, d.storedDetailId),
      storedDetailId: d.storedDetailId,
    };
  });
}

/** The forms a Part needs, once each, in the order the facts ask for them. */
export function factForms(facts: readonly UnknownFact[]): Exclude<FactForm, "answer" | null>[] {
  const out: Exclude<FactForm, "answer" | null>[] = [];
  for (const f of facts) {
    if (f.form && f.form !== "answer" && !out.includes(f.form)) out.push(f.form);
  }
  return out;
}
