/** Date and time normalization to ISO 8601. Pure functions; no I/O. */

export const DEFAULT_TIME_ZONE = "Asia/Tokyo";
export const DEFAULT_DUE_TIME = "09:00";

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isRealDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Browser time zone first, then DEFAULT_TIMEZONE, then Asia/Tokyo. */
export function resolveTimeZone(candidate?: string | null, envDefault?: string | null): string {
  if (isValidTimeZone(candidate)) return candidate;
  if (isValidTimeZone(envDefault)) return envDefault;
  return DEFAULT_TIME_ZONE;
}

function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Local date and time in a zone to an ISO 8601 string with offset, e.g. 2030-01-05T15:30:00+09:00. */
export function zonedToIso(date: string, time: string, timeZone: string): string | null {
  if (!isRealDate(date) || !isValidTime(time) || !isValidTimeZone(timeZone)) return null;
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let offset = offsetMinutes(guess, timeZone);
  const adjusted = offsetMinutes(guess - offset * 60000, timeZone);
  if (adjusted !== offset) offset = adjusted;
  const iso = `${date}T${time}:00${formatOffset(offset)}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** Today's date (YYYY-MM-DD) in the given zone. */
export function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function weekdayName(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(at);
}

export type DueWarning = "time_not_given" | "date_in_past" | "invalid_date";

export interface NormalizedDue {
  /** ISO 8601 with offset, or null when no usable date. */
  dueAt: string | null;
  dueDate: string | null;
  dueTime: string | null;
  timeDefaulted: boolean;
  warnings: DueWarning[];
}

/**
 * Combines a local date and optional time into ISO 8601. A date without a time becomes 09:00 and
 * is flagged `time_not_given` so the user reviews it.
 */
export function normalizeDue(input: {
  date: string | null;
  time: string | null;
  timeZone: string;
  referenceDate: Date;
}): NormalizedDue {
  const empty: NormalizedDue = {
    dueAt: null,
    dueDate: null,
    dueTime: null,
    timeDefaulted: false,
    warnings: [],
  };
  const { date, time, timeZone } = input;

  if (!date) {
    return time ? { ...empty, warnings: ["invalid_date"] } : empty;
  }
  if (!isRealDate(date) || (time && !isValidTime(time))) {
    return { ...empty, warnings: ["invalid_date"] };
  }

  const timeDefaulted = !time;
  const finalTime = time ?? DEFAULT_DUE_TIME;
  const dueAt = zonedToIso(date, finalTime, timeZone);
  if (!dueAt) return { ...empty, warnings: ["invalid_date"] };

  const warnings: DueWarning[] = [];
  if (timeDefaulted) warnings.push("time_not_given");
  if (date < localDate(input.referenceDate, timeZone)) warnings.push("date_in_past");
  return { dueAt, dueDate: date, dueTime: finalTime, timeDefaulted, warnings };
}

/** Local 24-hour time (HH:mm) in the given zone. */
export function localTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}
