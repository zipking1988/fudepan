const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED_NEXT = new RegExp(
  `^(/notes(/${UUID})?|/join|/welcome|/family(/(capture|members|invites|settings/language|(events|me)/${UUID}(/timeline)?))?)$`,
);

/**
 * Where a signed-in person goes when no allowed page was asked for: the family home. It also
 * sends a person without a household on to /welcome and a care recipient to their own view.
 */
export const DEFAULT_SIGNED_IN_PATH = "/family";

/**
 * Where to go after signing in. Only this app's note, family, join, and welcome pages are
 * allowed, so a crafted `?next=` link cannot send someone to another site. An allowed page asked
 * for on purpose (for example `/notes/<id>`) is kept; anything else becomes the family home.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SIGNED_IN_PATH;
  return ALLOWED_NEXT.test(value) ? value : DEFAULT_SIGNED_IN_PATH;
}

/**
 * Pages that need a signed-in person. The note image route answers 404 itself,
 * because a redirect to an HTML page would break <img>.
 */
export function isProtectedPagePath(pathname: string): boolean {
  if (pathname === "/notes" || pathname === "/family" || pathname === "/welcome") return true;
  if (pathname.startsWith("/family/")) return true;
  return pathname.startsWith("/notes/") && !pathname.endsWith("/image");
}
