import "server-only";

/**
 * Structured server logs that cannot carry sensitive content
 * (.kiro/hooks/mask-sensitive-data.md).
 *
 * Only allow-listed fields are written, and only values that look like IDs,
 * short machine codes, or numbers. Anything else (names, file names, paths,
 * URLs, tokens, free-form error messages) is replaced with "[REDACTED]".
 */

export type LogLevel = "info" | "warn" | "error";

export const LOG_FIELDS = [
  "user_id",
  "household_id",
  "note_id",
  "stage",
  "reason",
  "code",
  "status",
  "count",
] as const;

export type LogField = (typeof LOG_FIELDS)[number];
export type LogFields = Partial<Record<LogField, string | number | boolean | null | undefined>>;
export type Logger = (level: LogLevel, event: string, fields?: LogFields) => void;

const SAFE_STRING = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_EVENT = /^[a-z][a-z0-9_.]{0,63}$/;

export function maskLogFields(fields: Record<string, unknown> = {}): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const name of LOG_FIELDS) {
    const value = fields[name];
    if (value === undefined) continue;
    if (value === null || typeof value === "boolean") safe[name] = value;
    else if (typeof value === "number" && Number.isFinite(value)) safe[name] = value;
    else if (typeof value === "string" && SAFE_STRING.test(value)) safe[name] = value;
    else safe[name] = "[REDACTED]";
  }
  return safe;
}

/** Writes one JSON line. Vercel collects stdout and stderr. */
export const log: Logger = (level, event, fields) => {
  const line = JSON.stringify({
    level,
    event: SAFE_EVENT.test(event) ? event : "invalid_event_name",
    ...maskLogFields(fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

/** Error code for logs. Never the message, which may contain paths or content. */
export function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; statusCode?: unknown; status?: unknown; name?: unknown };
    for (const candidate of [e.code, e.statusCode, e.status, e.name]) {
      if (typeof candidate === "string" && SAFE_STRING.test(candidate)) return candidate;
      if (typeof candidate === "number") return String(candidate);
    }
  }
  return "unknown";
}
