/**
 * Reads the literal appointment date and local clock time from the original
 * note quote, e.g. "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm."
 *
 * The result is only a suggestion to prefill the appointment form. It has no
 * time zone: a person must confirm it in the zone shown on screen before it is
 * saved. Anything ambiguous returns null so the fields stay empty:
 *   - no year, or a numeric date like 11/27/2026 (month/day order unknown)
 *   - more than one date or more than one time
 *   - a weekday that does not match the date
 *   - a named time zone or offset (the form could not honour it)
 *   - words such as "morning" or "noon" instead of a clock time
 *   - a clock time like "2:30" with no am/pm and a one-digit hour
 */
export type AppointmentQuoteSuggestion = { date: string; time: string };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";

const DATE_PATTERNS: { re: RegExp; parts: (m: RegExpMatchArray) => [number, number, number] }[] = [
  // Nov 27, 2026 / November 27 2026
  {
    re: new RegExp(`\\b${MONTH}\\.?\\s+${DAY},?\\s+(\\d{4})\\b`, "gi"),
    parts: (m) => [Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2])],
  },
  // 27 Nov 2026 / 27 November, 2026
  {
    re: new RegExp(`\\b${DAY}\\s+${MONTH}\\.?,?\\s+(\\d{4})\\b`, "gi"),
    parts: (m) => [Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1])],
  },
  // 2026-11-27 / 2026/11/27 (year first is unambiguous)
  {
    re: /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g,
    parts: (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
  },
];

const NUMERIC_DAY_FIRST_OR_MONTH_FIRST = /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/;
const WEEKDAYS: [RegExp, number][] = [
  [/\bsun(?:day)?\b/gi, 0],
  [/\bmon(?:day)?\b/gi, 1],
  [/\btue(?:s|sday)?\b/gi, 2],
  [/\bwed(?:nesday)?\b/gi, 3],
  [/\bthu(?:r|rs|rsday)?\b/gi, 4],
  [/\bfri(?:day)?\b/gi, 5],
  [/\bsat(?:urday)?\b/gi, 6],
];
const NAMED_ZONE =
  /\b(?:UTC|GMT|JST|KST|CST|CDT|EST|EDT|MST|MDT|PST|PDT|BST|CET|CEST|AEST|AEDT)\b|[+-]\d{2}:?\d{2}\b|\b[A-Z][a-z]+\/[A-Z][A-Za-z_]+\b/;
const TIME_12H = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/gi;
/** 24-hour clock only with two-digit hours ("09:30", "14:30"); "2:30" alone could be am or pm. */
const TIME_24H = /\b(\d{2}):(\d{2})\b/g;
const BARE_CLOCK = /\b\d{1,2}:\d{2}\b/;

const pad = (n: number) => String(n).padStart(2, "0");

function realDate(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || !m || m > 12 || d < 1) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function parseAppointmentQuote(quote: string | null | undefined): AppointmentQuoteSuggestion | null {
  if (!quote) return null;
  const text = quote.normalize("NFKC");
  if (NAMED_ZONE.test(text) || NUMERIC_DAY_FIRST_OR_MONTH_FIRST.test(text.replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ""))) {
    return null;
  }

  // Dates
  const dates = new Set<string>();
  let rest = text;
  for (const { re, parts } of DATE_PATTERNS) {
    for (const m of rest.matchAll(re)) {
      const [y, mo, d] = parts(m);
      if (!realDate(y, mo, d)) return null;
      dates.add(`${y}-${pad(mo)}-${pad(d)}`);
    }
    rest = rest.replace(re, (s) => " ".repeat(s.length));
  }
  if (dates.size !== 1) return null;
  const [date] = dates;

  // Weekday, if written, must agree with the date.
  const [y, mo, d] = date.split("-").map(Number);
  const actualWeekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  const weekdays = new Set<number>();
  for (const [re, day] of WEEKDAYS) if (rest.match(re)) weekdays.add(day);
  if (weekdays.size > 1 || (weekdays.size === 1 && !weekdays.has(actualWeekday))) return null;

  // Times
  const times = new Set<string>();
  for (const m of rest.matchAll(TIME_12H)) {
    const hour = Number(m[1]);
    const minute = m[2] === undefined ? 0 : Number(m[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    const h24 = (hour % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    times.add(`${pad(h24)}:${pad(minute)}`);
  }
  rest = rest.replace(TIME_12H, (s) => " ".repeat(s.length));
  const without24h = rest.replace(TIME_24H, (s) => " ".repeat(s.length));
  if (BARE_CLOCK.test(without24h)) return null;
  for (const m of rest.matchAll(TIME_24H)) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) return null;
    times.add(`${pad(hour)}:${pad(minute)}`);
  }
  if (times.size !== 1) return null;
  const [time] = times;

  return { date, time };
}
