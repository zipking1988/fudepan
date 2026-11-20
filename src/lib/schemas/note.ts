import { z } from "zod";

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_NOTE_TEXT_LENGTH = 5000;

const uuid = z.string().uuid();

const textNote = z.object({
  householdId: uuid,
  sourceType: z.literal("text"),
  textContent: z.string().trim().min(1).max(MAX_NOTE_TEXT_LENGTH),
});

const imageNote = z.object({
  householdId: uuid,
  sourceType: z.literal("image"),
  imageMimeType: z.enum(ALLOWED_IMAGE_TYPES),
  imageSizeBytes: z.number().int().positive().max(MAX_IMAGE_BYTES),
});

/** Input for creating a note: pasted text or image metadata (the file itself goes to Storage). */
export const noteInputSchema = z.discriminatedUnion("sourceType", [textNote, imageNote]);
export type NoteInput = z.infer<typeof noteInputSchema>;
