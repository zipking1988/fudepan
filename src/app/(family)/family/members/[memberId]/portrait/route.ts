import { getSession } from "@/lib/auth/session";
import { openPortrait } from "@/lib/portraits/service";
import { createAdminClient } from "@/lib/supabase/admin";
/** A member's portrait for active members of the same household only. No public or long-lived URL. */
const HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;
function plain(status: number, text: string) {
  return new Response(text, { status, headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}
export async function GET(_request: Request, context: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await context.params;
  const { supabase, user } = await getSession();
  if (!user) return plain(401, "Sign in to see this photo.");
  try {
    const file = await openPortrait({ userClient: supabase, admin: createAdminClient(), userId: user.id, memberId });
    if (!file) return plain(404, "Photo not found.");
    return new Response(file.body, { status: 200, headers: { ...HEADERS, "Content-Type": file.contentType, "Content-Length": String(file.body.size) } });
  } catch {
    return plain(503, "The photo could not be loaded.");
  }
}
