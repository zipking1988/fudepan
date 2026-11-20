import { maskSensitive } from "@/lib/safety/mask-sensitive";

/**
 * Builds an iCalendar (RFC 5545) file for one confirmed task. Pure function, no I/O.
 *
 * Data minimisation: only the masked title, the masked location, the due time, the category and a
 * link back to Fudepan go into the file. Task notes and note text are never included.
 */
export interface CalendarTaskInput {
  taskId: string;
  title: string;
  categoryLabel: string;
  dueAt: string;
  location: string | null;
  taskUrl: string;
  durationMinutes?: number;
  /** Minutes before the start for a reminder alarm. Null for no alarm. */
  alarmMinutes?: number | null;
  now?: Date;
}

export const ICS_CONTENT_TYPE = "text/calendar; charset=utf-8";
const DEFAULT_DURATION_MINUTES = 30;
const DEFAULT_ALARM_MINUTES = 60;

/** Escapes TEXT values (RFC 5545 section 3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line to at most 75 octets without splitting a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = char;
      bytes = size;
      limit = 74; // continuation lines start with one space
    } else {
      current += char;
      bytes += size;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** UTC date-time in basic format, e.g. 20300105T063000Z. */
export function toIcsUtc(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export function buildTaskIcs(input: CalendarTaskInput): string {
  const start = new Date(input.dueAt);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid due date");
  const end = new Date(
    start.getTime() + (input.durationMinutes ?? DEFAULT_DURATION_MINUTES) * 60_000,
  );
  const title = maskSensitive(input.title).text;
  const location = input.location ? maskSensitive(input.location).text : null;
  const alarm = input.alarmMinutes === undefined ? DEFAULT_ALARM_MINUTES : input.alarmMinutes;
  const description = [
    `Household task from Fudepan (${input.categoryLabel}).`,
    "Approved by a family member. Fudepan has not paid, booked, or sent anything.",
    `Details: ${input.taskUrl}`,
  ].join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fudepan//Household Tasks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.taskId}@fudepan`,
    `DTSTAMP:${toIcsUtc(input.now ?? new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    ...(location ? [`LOCATION:${escapeIcsText(location)}`] : []),
    `DESCRIPTION:${escapeIcsText(description)}`,
    `URL:${input.taskUrl}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    ...(alarm !== null
      ? [
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeIcsText(title)}`,
          `TRIGGER:-PT${Math.max(0, Math.round(alarm))}M`,
          "END:VALARM",
        ]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** A safe ASCII file name for the download. */
export function icsFileName(title: string): string {
  const slug = maskSensitive(title)
    .text.normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40);
  return `${slug || "fudepan-task"}.ics`;
}
