/**
 * Pure formatting helpers (family-shared-care design, "i18n"). No I/O, no clock, no server-only imports.
 * Safe on the server and in the browser: the same input gives the same text.
 */
import {
  formatDateTimeInZone as formatPlainInZone,
  formatLocalDateTime,
  formatUtcDateTime,
} from "@/lib/format-date";

export type Language = "en" | "ja";

const LOCALE: Record<Language, string> = { en: "en-US", ja: "ja-JP" };

const ZONE_SUFFIX: Record<Language, (zone: string) => string> = {
  en: (zone) => `(${zone} time)`,
  ja: (zone) => `（${zone} 時間）`,
};

/** "2026年11月27日(金) 14:30": Japanese date and 24-hour time, in an explicit zone or the reader's own. */
function japaneseDateTime(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    ...(timeZone ? { timeZone } : {}),
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}年${get("month")}月${get("day")}日(${get("weekday")}) ${get("hour")}:${get("minute")}`;
}

/** The reader's own time zone. Browser only. English matches `formatLocalDateTime`. */
export function formatLocalDateTimeLang(date: Date, lang: Language): string {
  return lang === "ja" ? japaneseDateTime(date) : formatLocalDateTime(date);
}

/** UTC, labelled as such, for server renders before the browser knows its zone. */
export function formatUtcDateTimeLang(date: Date, lang: Language): string {
  return lang === "ja" ? `${japaneseDateTime(date, "UTC")} UTC` : formatUtcDateTime(date);
}

/**
 * A date and time in a named IANA zone, with the zone written out, for example
 * "Fri, November 27, 2026 at 2:30 PM (Asia/Tokyo time)", or in Japanese
 * "2026年11月27日(金) 14:30（Asia/Tokyo 時間）". The zone is always shown so a time is
 * never read in the wrong place. Throws a RangeError for an unknown zone: a wrong time is worse
 * than no time.
 */
export function formatDateTimeInZone(date: Date, timeZone: string, lang: Language): string {
  const text =
    lang === "en"
      ? formatPlainInZone(date, timeZone)
      : japaneseDateTime(date, timeZone);
  return lang === "ja" ? `${text}${ZONE_SUFFIX.ja(timeZone)}` : `${text} ${ZONE_SUFFIX[lang](timeZone)}`;
}

/** "A, B, and C" in English. An empty list gives an empty string. */
export function formatList(items: readonly string[], lang: Language, type: "and" | "or" = "and"): string {
  return new Intl.ListFormat(LOCALE[lang], {
    style: "long",
    type: type === "and" ? "conjunction" : "disjunction",
  }).format(items);
}

export type PluralCategory = "one" | "other";

/** The plural form for a count. English and Japanese need only `one` and `other`. */
export function pluralCategory(count: number, lang: Language): PluralCategory {
  return new Intl.PluralRules(LOCALE[lang]).select(count) === "one" ? "one" : "other";
}
