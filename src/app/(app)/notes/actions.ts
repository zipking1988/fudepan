"use server";

import { after } from "next/server";
import { z } from "zod";

import { getSession } from "@/lib/auth/session";
import { createDefaultRecognizer } from "@/lib/care/recognition";
import { log } from "@/lib/log";
import { createNoteUploadService, type ServiceResult } from "@/lib/notes/upload-service";
import { createSupabaseNoteUploadStore } from "@/lib/notes/upload-store";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server Actions for the upload form. Each one re-reads and verifies the
 * session; nothing the browser sends is trusted (inputs are parsed with Zod
 * inside the service).
 */

async function withService<T>(
  run: (
    service: ReturnType<typeof createNoteUploadService>,
    user: Awaited<ReturnType<typeof getSession>>["user"],
  ) => Promise<ServiceResult<T>>,
): Promise<ServiceResult<T>> {
  const { supabase, user } = await getSession();
  const store = createSupabaseNoteUploadStore({ userClient: supabase, admin: createAdminClient() });
  return run(createNoteUploadService({ store, log }), user);
}

export async function prepareNoteUpload(input: unknown) {
  return withService((service, user) => service.prepare(user, input));
}

/**
 * Recognition runs in `after()`, so it continues after the response is sent
 * and even if the person closes the page (Requirement 2.14). On Vercel the
 * callback shares the `maxDuration` of the route segment that hosts the
 * action: a Server Function runs inside the route of the page that calls it,
 * so `export const maxDuration = 300` is set on the notes pages (list and
 * detail), not here. The ai& calls time out sooner (see lib/ai/client.ts) and
 * the run lease is longer (see lib/care/recognition.ts).
 */
function scheduleRecognition(noteId: string, userId: string) {
  after(async () => {
    // recognize() never throws; start_recognition_run makes a repeat a no-op.
    await createDefaultRecognizer().recognize(noteId, userId);
  });
}

export async function completeNoteUpload(input: unknown) {
  return withService(async (service, user) => {
    const result = await service.complete(user, input);
    // A repeated completion (lost response, double click) must not schedule again.
    if (result.ok && user && !result.alreadyCompleted) scheduleRecognition(result.noteId, user.id);
    return result;
  });
}

export type RetryRecognitionResult = { ok: true } | { ok: false; error: string };

const retryInput = z.uuid();

/**
 * Starts reading the SAME note again after a failed run. Safe to call twice:
 * `start_recognition_run` returns "already running" for the second call and
 * ai& is not called again. The database also checks that the person is an
 * active member of the note's household.
 */
export async function retryRecognition(noteId: unknown): Promise<RetryRecognitionResult> {
  const parsed = retryInput.safeParse(noteId);
  if (!parsed.success) return { ok: false, error: "This note could not be found." };
  const { supabase, user } = await getSession();
  if (!user) return { ok: false, error: "You must be signed in." };

  // Row-level security: only a note of one of the person's households is visible.
  const { data: note } = await supabase.from("notes").select("id").eq("id", parsed.data).maybeSingle();
  if (!note) return { ok: false, error: "This note could not be found, or you do not have access to it." };

  scheduleRecognition(parsed.data, user.id);
  return { ok: true };
}

export async function reportNoteUploadFailure(input: unknown) {
  return withService((service, user) => service.reportFailure(user, input));
}
