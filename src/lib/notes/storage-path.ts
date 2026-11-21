import { isUuid } from "@/lib/ids";

import { NOTE_FILE_EXTENSIONS, type NoteContentType } from "./rules";

/**
 * Storage object paths: `{household_id}/{note_id}/{epoch_ms}-note.{jpg|png|webp}`.
 *
 * The server builds every path. The original file name is never used, because
 * names like "mom-insulin.jpg" carry sensitive information.
 */

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_PATTERN = new RegExp(`^(${UUID})/(${UUID})/([0-9]{13})-note\\.(jpg|png|webp)$`);

const TYPE_BY_EXTENSION: Record<string, NoteContentType> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export function buildNoteObjectPath(
  householdId: string,
  noteId: string,
  contentType: NoteContentType,
  now: Date,
): string {
  if (!isUuid(householdId) || !isUuid(noteId)) {
    throw new Error("Note object paths need lowercase UUIDs");
  }
  const timestamp = String(now.getTime()).padStart(13, "0");
  return `${householdId}/${noteId}/${timestamp}-note.${NOTE_FILE_EXTENSIONS[contentType]}`;
}

export type ParsedNoteObjectPath = {
  householdId: string;
  noteId: string;
  contentType: NoteContentType;
};

export function parseNoteObjectPath(path: string): ParsedNoteObjectPath | null {
  const match = PATH_PATTERN.exec(path);
  if (!match) return null;
  const [, householdId, noteId, , extension] = match;
  return { householdId, noteId, contentType: TYPE_BY_EXTENSION[extension] };
}

/** True only for a well-formed path inside this household's folder for this note. */
export function isNoteObjectPathFor(path: string, householdId: string, noteId: string): boolean {
  const parsed = parseNoteObjectPath(path);
  return parsed !== null && parsed.householdId === householdId && parsed.noteId === noteId;
}
