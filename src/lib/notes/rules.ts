/**
 * Note upload rules shared by the browser and the server.
 * supabase/migrations/20261121000000_note_uploads.sql enforces the same limits
 * in the Storage bucket and the database; keep them in sync.
 */

export const NOTES_BUCKET = "notes";

/** 10 MB, matching the bucket's file_size_limit (10485760 bytes). */
export const MAX_NOTE_BYTES = 10 * 1024 * 1024;

export const NOTE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type NoteContentType = (typeof NOTE_CONTENT_TYPES)[number];

export const NOTE_FILE_EXTENSIONS: Record<NoteContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Value for the file input's `accept` attribute. */
export const NOTE_FILE_ACCEPT = "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";

export function isNoteContentType(value: unknown): value is NoteContentType {
  return typeof value === "string" && (NOTE_CONTENT_TYPES as readonly string[]).includes(value);
}
