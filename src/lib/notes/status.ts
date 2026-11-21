/** Note statuses allowed by notes_status_valid in the Phase 1 schema. */
export const NOTE_STATUSES = [
  "uploaded",
  "extracting",
  "extraction_failed",
  "pending_review",
] as const;

export type NoteStatus = (typeof NOTE_STATUSES)[number];

export function isNoteStatus(value: unknown): value is NoteStatus {
  return typeof value === "string" && (NOTE_STATUSES as readonly string[]).includes(value);
}

/** Plain-language status, always shown as text (never color alone). */
export const NOTE_STATUS_TEXT: Record<NoteStatus, { label: string; description: string }> = {
  uploaded: {
    label: "Uploaded",
    description: "The photo is saved. Fudepan has not read it yet.",
  },
  extracting: {
    label: "Being read",
    description: "Fudepan is reading the handwriting.",
  },
  extraction_failed: {
    label: "Could not be read",
    description: "Fudepan could not read this note. A family member needs to check it.",
  },
  pending_review: {
    label: "Ready for review",
    description: "Care steps are drafted and waiting for a family member to check them.",
  },
};
