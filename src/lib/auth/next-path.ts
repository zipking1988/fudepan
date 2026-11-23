const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED_NEXT = new RegExp(
  `^(/notes(/${UUID})?|/family(/(capture|settings/language|(events|me)/${UUID}(/timeline)?))?)$`,
);
/**
 * Where to go after signing in. Only this app's note and family pages are
 * allowed, so a crafted `?next=` link cannot send someone to another site.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return "/notes";
  return ALLOWED_NEXT.test(value) ? value : "/notes";
}
/**
 * Pages that need a signed-in person. The note image route answers 404 itself,
 * because a redirect to an HTML page would break <img>.
 */
export function isProtectedPagePath(pathname: string): boolean {
  if (pathname === "/notes" || pathname === "/family") return true;
  if (pathname.startsWith("/family/")) return true;
  return pathname.startsWith("/notes/") && !pathname.endsWith("/image");
}
