"use server";

import { getSession } from "@/lib/auth/session";
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

export async function completeNoteUpload(input: unknown) {
  return withService((service, user) => service.complete(user, input));
}

export async function reportNoteUploadFailure(input: unknown) {
  return withService((service, user) => service.reportFailure(user, input));
}
