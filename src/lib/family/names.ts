/**
 * Names in Warm_Copy (family-app-demo-parity design, "Pure modules"; Requirements 25.8, 25.9).
 *
 * Pure: no I/O, no dictionary. Names are shown as the family wrote them, never translated.
 */

/** "Haruko (Mom)" -> "Haruko". The family's note in brackets is dropped; nothing else changes. */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? "").replace(/\s*[(（].*?[)）]\s*/g, " ").trim();
}

/** Japanese endings that already make a name polite or familiar (design K15). */
export const HONORIFIC_ENDINGS = ["さん", "ちゃん", "様", "くん"] as const;

/** True when the trimmed name already ends with an honorific, so no second one is added. */
export function hasHonorific(name: string): boolean {
  const trimmed = name.trim();
  return HONORIFIC_ENDINGS.some((ending) => trimmed.endsWith(ending));
}

/**
 * A name as it is said politely in the reader's language: Japanese adds さん unless the name already
 * ends with an honorific; English keeps the name as written.
 */
export function withHonorific(name: string, reader: { lang: "en" | "ja" }): string {
  const trimmed = name.trim();
  if (reader.lang !== "ja" || trimmed === "" || hasHonorific(trimmed)) return trimmed;
  return `${trimmed}さん`;
}

/**
 * Care_Recipient_Name: the first name of the household's only active Care_Recipient.
 * Null when there is none, more than one, or the first name is blank, so Warm_Copy uses its
 * neutral form instead of a sentence with an empty name (Requirement 25.8).
 */
export function careRecipientName(
  members: readonly { role: string; isActive: boolean; displayName: string }[],
): string | null {
  const recipients = members.filter((m) => m.isActive && m.role === "care_recipient");
  if (recipients.length !== 1) return null;
  const name = firstName(recipients[0].displayName);
  return name === "" ? null : name;
}
