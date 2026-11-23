const OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** In the reader's own time zone. Browser only: the server does not know it. */
export function formatLocalDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", OPTIONS).format(date);
}

/**
 * In a named IANA time zone, e.g. the zone an appointment was entered in.
 * Same output on server and browser, so it is safe to render on the server.
 */
export function formatDateTimeInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { ...OPTIONS, timeZone }).format(date);
}

/** Server-rendered fallback until the browser takes over. Says "UTC" so it is never misread. */
export function formatUtcDateTime(date: Date): string {
  return `${new Intl.DateTimeFormat("en-US", { ...OPTIONS, timeZone: "UTC" }).format(date)} UTC`;
}
