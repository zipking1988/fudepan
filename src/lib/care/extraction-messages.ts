/**
 * Plain-language messages for why reading a note failed. Never shows the raw
 * reason code or any model output. Every message says what to do next.
 */
const MESSAGES: Record<string, string> = {
  signed_out: "You were signed out. Sign in again, then open the note to read it.",
  note_not_found: "This note could not be found, or you do not have access to it.",
  image_not_found: "The photo of this note could not be opened. Try uploading it again.",
  model_unavailable:
    "Reading notes is not set up on this machine yet. The photo is saved. Ask the person who runs Fudepan to add AIAND_API_KEY, AIAND_BASE_URL, and AIAND_MODEL.",
  upload_failed: "Fudepan could not reach the reading service. The photo is saved. Try again in a minute.",
  completion_failed: "The reading service did not answer. The photo is saved. Try again in a minute.",
  invalid_json:
    "Fudepan could not understand the reading service's answer, so nothing was saved from it. Try again.",
  schema_invalid:
    "The draft was incomplete, so nothing was saved from it. Try again, or use a clearer photo of the whole note.",
  safety_violation:
    "The draft broke a safety rule (for example, it skipped a required confirmation), so nothing was saved from it. Try again.",
  being_read:
    "This note is already being read. Open it again in a minute to see the result.",
  db_error: "The draft could not be saved. Try again.",
};

export function extractionFailureMessage(reason: string): string {
  return MESSAGES[reason] ?? "Fudepan could not read this note. The photo is saved. Try again.";
}
