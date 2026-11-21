import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { memberNames } from "@/lib/households/queries";
import { isUuid } from "@/lib/ids";
import type { Database } from "@/lib/supabase/database.types";

import { NOTES_BUCKET, type NoteContentType } from "./rules";
import { isNoteStatus, type NoteStatus } from "./status";
import { isNoteObjectPathFor, parseNoteObjectPath } from "./storage-path";

type Client = SupabaseClient<Database>;

export type NoteSummary = {
  id: string;
  status: NoteStatus;
  createdAt: string;
  uploaderName: string | null;
};

export const NOTES_PAGE_SIZE = 50;

/**
 * Notes of one household, newest first. `supabase` must be the person's own
 * row-level-security client: notes from households they do not belong to are
 * never returned, whatever `householdId` says.
 */
export async function listHouseholdNotes(
  supabase: Client,
  householdId: string,
): Promise<NoteSummary[]> {
  const [{ data, error }, names] = await Promise.all([
    supabase
      .from("notes")
      .select("id, status, created_at, uploaded_by")
      .eq("household_id", householdId)
      .order("created_at", { ascending: false })
      .limit(NOTES_PAGE_SIZE),
    memberNames(supabase, householdId),
  ]);
  if (error) throw new Error("notes_query_failed");

  return data.flatMap((note) =>
    isNoteStatus(note.status)
      ? [
          {
            id: note.id,
            status: note.status,
            createdAt: note.created_at,
            uploaderName: names.get(note.uploaded_by) ?? null,
          },
        ]
      : [],
  );
}

export type NoteDetail = NoteSummary & {
  householdId: string;
  householdName: string;
};

/** One note, or null when it does not exist or belongs to another household. */
export async function getNoteDetail(supabase: Client, noteId: string): Promise<NoteDetail | null> {
  if (!isUuid(noteId)) return null;
  const { data, error } = await supabase
    .from("notes")
    .select("id, household_id, status, created_at, uploaded_by, households ( name )")
    .eq("id", noteId)
    .maybeSingle();
  if (error) throw new Error("note_query_failed");
  if (!data || !data.households || !isNoteStatus(data.status)) return null;

  const names = await memberNames(supabase, data.household_id);
  return {
    id: data.id,
    householdId: data.household_id,
    householdName: data.households.name,
    status: data.status,
    createdAt: data.created_at,
    uploaderName: names.get(data.uploaded_by) ?? null,
  };
}

export type NoteImage = {
  body: ReadableStream<Uint8Array>;
  contentType: NoteContentType;
  contentLength: string | null;
};

/**
 * Streams a note's original image for a member of its household.
 *
 * Authorization comes from the person's own client: if row-level security does
 * not return the note, there is no image. The service role is used only to
 * read that one verified object, through a 60-second signed URL that never
 * leaves the server.
 */
export async function openNoteImage({
  userClient,
  admin,
  noteId,
  fetchImpl = fetch,
}: {
  userClient: Client;
  admin: Client;
  noteId: string;
  fetchImpl?: typeof fetch;
}): Promise<NoteImage | null> {
  if (!isUuid(noteId)) return null;
  const { data: note, error } = await userClient
    .from("notes")
    .select("id, household_id, image_path")
    .eq("id", noteId)
    .maybeSingle();
  if (error || !note) return null;

  const parsed = parseNoteObjectPath(note.image_path);
  if (!parsed || !isNoteObjectPathFor(note.image_path, note.household_id, note.id)) return null;

  const { data: signed, error: signError } = await admin.storage
    .from(NOTES_BUCKET)
    .createSignedUrl(note.image_path, 60);
  if (signError) return null;

  const response = await fetchImpl(signed.signedUrl, { cache: "no-store" });
  if (!response.ok || !response.body) return null;

  return {
    body: response.body,
    contentType: parsed.contentType,
    contentLength: response.headers.get("content-length"),
  };
}
