import { getSession } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { openNoteImage } from "@/lib/notes/queries";
import { NOTE_FILE_EXTENSIONS } from "@/lib/notes/rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The original note photo, for members of its household only.
 *
 * There is no public or long-lived URL: this route checks the session and
 * household on every request and streams the bytes from private Storage.
 * Streaming also keeps 10 MB photos clear of Vercel's 4.5 MB response cap.
 */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; sandbox",
} as const;

function plain(status: number, text: string): Response {
  return new Response(text, {
    status,
    headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(_request: Request, context: RouteContext<"/notes/[noteId]/image">) {
  const { noteId } = await context.params;
  const { supabase, user } = await getSession();
  if (!user) return plain(401, "Sign in to see this note.");

  let image: Awaited<ReturnType<typeof openNoteImage>> = null;
  try {
    image = await openNoteImage({ userClient: supabase, admin: createAdminClient(), noteId });
  } catch {
    log("error", "note_image.failed", { user_id: user.id });
    return plain(503, "The photo could not be loaded. Try again in a minute.");
  }
  // Not found and not yours look the same.
  if (!image) return plain(404, "Note not found.");

  const headers: Record<string, string> = {
    ...PRIVATE_HEADERS,
    "Content-Type": image.contentType,
    "Content-Disposition": `inline; filename="note.${NOTE_FILE_EXTENSIONS[image.contentType]}"`,
  };
  if (image.contentLength && /^\d+$/.test(image.contentLength)) {
    headers["Content-Length"] = image.contentLength;
  }
  return new Response(image.body, { status: 200, headers });
}
