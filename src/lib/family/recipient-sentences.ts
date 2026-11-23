/**
 * Recipient_View sentence model (family-shared-care design, Recipient_View; Requirements 13.2, 13.3, 13.6).
 *
 * Pure: no I/O, no clock, no server-only imports. Returns message keys and params only, so the
 * page translates them with `createTranslator`. The sentences carry no actions.
 *
 * Rules kept here:
 * - Only a `human_confirmed` appointment time is stated. A model-suggested time is never shown.
 * - Missing details use the kind's own key. The ai& question text is never shown.
 * - No evidence, amounts, reminders, confidence, or internal words appear in any sentence.
 */
import type { EventPart, MemberRef, SharedCareEvent } from "@/lib/family/shared-care-event";
import { formatDateTimeInZone, type Language } from "@/lib/i18n/format";
import type { MessageKey } from "@/lib/i18n/en";
import type { MessageParams } from "@/lib/i18n/messages";

export type RecipientSentence = { key: MessageKey; params?: MessageParams };

function nameOf(member: MemberRef | null): string | null {
  const name = member?.name?.trim();
  return name ? name : null;
}

function helper(
  member: MemberRef | null,
  named: MessageKey,
  unnamed: MessageKey,
): RecipientSentence | null {
  if (!member) return null;
  const name = nameOf(member);
  return name ? { key: named, params: { name } } : { key: unnamed };
}

const MISSING_BY_CODE: Record<string, MessageKey> = {
  which_clinic: "recipient.missing.which_clinic",
  which_date: "recipient.missing.which_date",
  which_time: "recipient.missing.which_time",
  which_amount: "recipient.missing.which_amount",
  who_will_drive: "recipient.missing.who_will_drive",
  when_is_deadline: "recipient.missing.when_is_deadline",
  which_person: "recipient.missing.which_person",
  which_document: "recipient.missing.which_document",
  which_contact: "recipient.missing.which_contact",
};

const MISSING_BY_KIND: Record<string, MessageKey> = {
  date: "recipient.missing.which_date",
  time: "recipient.missing.which_time",
  location: "recipient.missing.which_clinic",
  person: "recipient.missing.which_person",
  document: "recipient.missing.which_document",
  amount: "recipient.missing.which_amount",
  contact: "recipient.missing.which_contact",
};

function missingKey(detail: { kind: string; questionCode: string }): MessageKey | null {
  // `ai_question` is free text from the model, so it falls back to the kind.
  return MISSING_BY_CODE[detail.questionCode] ?? MISSING_BY_KIND[detail.kind] ?? null;
}

function appointmentSentence(part: EventPart, lang: Language): RecipientSentence {
  const t = part.confirmed.appointment;
  if (t && t.provenance === "human_confirmed") {
    const at = new Date(t.at);
    if (!Number.isNaN(at.getTime())) {
      try {
        return { key: "recipient.visitOn", params: { when: formatDateTimeInZone(at, t.timeZone, lang) } };
      } catch {
        // Unknown zone: a wrong time is worse than no time.
      }
    }
  }
  return { key: "recipient.timeNotConfirmed" };
}

function isClosed(part: EventPart): boolean {
  return part.progressStatus === "completed" || part.progressStatus === "cancelled";
}

/** Sentences for one open Part, in reading order. A closed Part gives none. */
export function sentencesForPart(part: EventPart, lang: Language = "en"): RecipientSentence[] {
  if (isClosed(part)) return [];
  const out: RecipientSentence[] = [];
  const isAppointment = part.careCategory === "appointment";

  const driver = helper(part.driver, "recipient.helper.driver", "recipient.helper.driverUnnamed");
  if (driver) out.push(driver);
  const companion = helper(part.companion, "recipient.helper.companion", "recipient.helper.companionUnnamed");
  if (companion) out.push(companion);
  else if (isAppointment) out.push({ key: "recipient.helper.noCompanion" });
  if (part.owner && part.owner.id !== part.driver?.id && part.owner.id !== part.companion?.id) {
    const owner = helper(part.owner, "recipient.helper.owner", "recipient.helper.ownerUnnamed");
    if (owner) out.push(owner);
  }

  let timeUnconfirmed = false;
  if (isAppointment) {
    const s = appointmentSentence(part, lang);
    timeUnconfirmed = s.key === "recipient.timeNotConfirmed";
    out.push(s);
  }

  if (part.approvalState === "pending" || part.approvalState === "rejected") {
    out.push({ key: "recipient.checking" });
  }

  const seen = new Set<MessageKey>();
  for (const detail of part.missingDetails) {
    // "The time is not confirmed yet." already covers a missing appointment time.
    if (timeUnconfirmed && detail.kind === "time") continue;
    const key = missingKey(detail);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push({ key });
    }
  }
  return out;
}

/** The ordered sentences the Recipient_View shows for one event. */
export function recipientSentences(event: SharedCareEvent, lang: Language = "en"): RecipientSentence[] {
  if (event.state === "reading" || event.state === "uploaded") return [{ key: "recipient.beingRead" }];
  if (event.state === "failed") return [{ key: "recipient.notRead" }];
  if (event.done) return [{ key: "recipient.allDone" }];
  return event.parts.flatMap((part) => sentencesForPart(part, lang));
}
