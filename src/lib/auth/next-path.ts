/**
 * Where to go after signing in. Only this app's note pages are allowed, so a
 * crafted `?next=` link cannot send someone to another site.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/notes";
  return /^\/notes(\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(value)
    ? value
    : "/notes";
}
