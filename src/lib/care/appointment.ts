import { z } from "zod";

/**
 * Appointment details a person adds to an appointment step (hospital or
 * clinic, date, time). Shared by the step card (browser) and the server
 * action, so both agree on exactly what is sent.
 *
 * The appointment is stored as one instant (ISO 8601 with an offset, sent as
 * UTC "Z") plus the IANA time zone the person entered it in. Showing the time
 * in that zone gives back exactly what they typed, wherever the reader is.
 * It is kept apart from due_at (the family's deadline) and escalation_at.
 */

export const APPOINTMENT_LOCATION_MAX = 200;

/**
 * On appointment steps, due_at and escalation_at only ever come from the AI
 * draft (no human path writes them). The model turns a local clock time such
 * as "2:30 pm" into an instant by guessing a time zone, so the result is not
 * a family deadline. Those values are not shown, not used for the overdue
 * check, and not stored for new drafts. The literal time in the note quote is
 * offered as a suggestion in the appointment form instead.
 * Other categories keep their deadlines unchanged.
 */
export function hasModelOnlyDeadline(careCategory: string): boolean {
  return careCategory === "appointment";
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** IANA names such as "Asia/Tokyo", "America/Argentina/Buenos_Aires", "UTC". Not raw offsets. */
const ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64 || !ZONE_RE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "America/New_York" → "America/New York" for reading aloud and on screen. */
export function timeZoneLabel(timeZone: string): string {
  return timeZone.replace(/_/g, " ");
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The calendar date ("YYYY-MM-DD") and clock time ("HH:MM") of an instant in a zone. */
export function wallClockInZone(instant: Date, timeZone: string): { date: string; time: string } {
  const p = zonedParts(instant, timeZone);
  return { date: `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

function offsetMs(instantMs: number, timeZone: string): number {
  const p = zonedParts(new Date(instantMs), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instantMs;
}

export type ZonedTimeResult =
  | { ok: true; instant: Date }
  | { ok: false; reason: "invalid_date" | "invalid_time" | "invalid_zone" | "nonexistent_time" };

/**
 * The instant at which the clocks in `timeZone` show `localDate` `localTime`.
 * Works the same in any browser or server zone. Times skipped by a daylight
 * saving change do not exist and are refused; for a repeated hour the
 * earlier one is used.
 */
export function zonedTimeToInstant(
  localDate: string,
  localTime: string,
  timeZone: string,
): ZonedTimeResult {
  const d = DATE_RE.exec(localDate);
  if (!d) return { ok: false, reason: "invalid_date" };
  const t = TIME_RE.exec(localTime);
  if (!t) return { ok: false, reason: "invalid_time" };
  if (!isValidTimeZone(timeZone)) return { ok: false, reason: "invalid_zone" };

  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  if (year < MIN_YEAR || year > MAX_YEAR) return { ok: false, reason: "invalid_date" };

  const wallAsUtc = Date.UTC(year, month - 1, day, Number(t[1]), Number(t[2]));
  const calendar = new Date(wallAsUtc);
  if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return { ok: false, reason: "invalid_date" };
  }

  // Two passes settle on the right side of a daylight saving change.
  let instant = wallAsUtc - offsetMs(wallAsUtc, timeZone);
  instant = wallAsUtc - offsetMs(instant, timeZone);

  const back = wallClockInZone(new Date(instant), timeZone);
  if (back.date !== localDate || back.time !== localTime) {
    return { ok: false, reason: "nonexistent_time" };
  }
  return { ok: true, instant: new Date(instant) };
}

// ---------------------------------------------------------------------------
// What the card sends and the server accepts
// ---------------------------------------------------------------------------

export const appointmentClarificationInput = z.object({
  stepId: z.uuid(),
  location: z.string().trim().min(1).max(APPOINTMENT_LOCATION_MAX),
  /** ISO 8601 instant that must carry "Z" or an offset. A bare local time is refused. */
  appointmentAt: z.iso.datetime({ offset: true }),
  timeZone: z.string().refine(isValidTimeZone),
  /** What the person typed, so the server can confirm the instant matches it in timeZone. */
  localDate: z.string().regex(DATE_RE),
  localTime: z.string().regex(TIME_RE),
});

export type AppointmentClarificationInput = z.infer<typeof appointmentClarificationInput>;

export const APPOINTMENT_MESSAGES = {
  zoneUnknown:
    "Your device's time zone could not be read, so the time cannot be saved accurately. Please reload the page and try again.",
  invalidDate: "Please check the date. It needs to be a real calendar date between 2000 and 2100.",
  invalidTime: "Please check the time.",
  locationTooLong: `The hospital or clinic name can be up to ${APPOINTMENT_LOCATION_MAX} characters.`,
  nonexistent: (localTime: string, localDate: string, timeZone: string) =>
    `${localTime} on ${localDate} does not exist in ${timeZoneLabel(timeZone)} time because the clocks change that day. Please check the time.`,
} as const;

function listMissing(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Turns the card's form fields into the action input. Returns a plain-language
 * message naming exactly what is missing or wrong instead of sending anything.
 */
export function buildAppointmentClarificationInput(values: {
  stepId: string;
  location: string;
  localDate: string;
  localTime: string;
  timeZone: string | null;
}): { ok: true; input: AppointmentClarificationInput } | { ok: false; error: string } {
  const location = values.location.trim();
  const missing = [
    !location && "hospital or clinic name",
    !values.localDate && "appointment date",
    !values.localTime && "appointment time",
  ].filter((m): m is string => Boolean(m));
  if (missing.length > 0) return { ok: false, error: `Please add the ${listMissing(missing)}.` };
  if (location.length > APPOINTMENT_LOCATION_MAX) return { ok: false, error: APPOINTMENT_MESSAGES.locationTooLong };
  if (!values.timeZone || !isValidTimeZone(values.timeZone)) {
    return { ok: false, error: APPOINTMENT_MESSAGES.zoneUnknown };
  }

  const result = zonedTimeToInstant(values.localDate, values.localTime, values.timeZone);
  if (!result.ok) {
    const error =
      result.reason === "nonexistent_time"
        ? APPOINTMENT_MESSAGES.nonexistent(values.localTime, values.localDate, values.timeZone)
        : result.reason === "invalid_time"
          ? APPOINTMENT_MESSAGES.invalidTime
          : result.reason === "invalid_zone"
            ? APPOINTMENT_MESSAGES.zoneUnknown
            : APPOINTMENT_MESSAGES.invalidDate;
    return { ok: false, error };
  }

  return {
    ok: true,
    input: {
      stepId: values.stepId,
      location,
      appointmentAt: result.instant.toISOString(),
      timeZone: values.timeZone,
      localDate: values.localDate,
      localTime: values.localTime,
    },
  };
}

// ---------------------------------------------------------------------------
// The appointment_clarified audit payload, as written by the SQL function
// ---------------------------------------------------------------------------

const savedDetails = z.object({
  location: z.string().min(1),
  appointment_time: z.iso.datetime({ offset: true }),
  timezone: z.string().refine(isValidTimeZone),
});

const appointmentClarifiedPayload = savedDetails.extend({
  clarified_by: z.uuid(),
  /** Values replaced by a correction. Each may be null if it was never set. */
  previous: z
    .object({
      location: z.string().nullable(),
      appointment_time: z.iso.datetime({ offset: true }).nullable(),
      timezone: z.string().refine(isValidTimeZone).nullable(),
    })
    .nullable()
    .optional(),
});

export type AppointmentClarifiedPayload = z.infer<typeof appointmentClarifiedPayload>;

/** Null when the payload is not a well-formed appointment_clarified record. */
export function parseAppointmentClarifiedPayload(payload: unknown): AppointmentClarifiedPayload | null {
  const parsed = appointmentClarifiedPayload.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
