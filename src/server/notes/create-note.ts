import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { OCR_ERROR_MESSAGES, OcrError, isLowConfidence, type OcrAdapter } from "@/lib/ocr";
import { maskSensitive, type SensitiveKind } from "@/lib/safety/mask-sensitive";
import { extensionFor, type ValidatedImage } from "@/lib/uploads/validate";

export const NOTE_IMAGES_BUCKET = "note-images";

export type OcrStatus = "done" | "no_text" | "skipped" | "failed";

export interface CreateNoteResult {
  noteId: string;
  ocrStatus: OcrStatus;
  lowConfidence: boolean;
  maskedKinds: SensitiveKind[];
  /** Plain-language message when OCR did not run or failed. */
  ocrMessage: string | null;
}

export class NoteServiceError extends Error {
  constructor(
    public readonly code: "storage_failed" | "database_failed",
    message: string,
  ) {
    super(message);
    this.name = "NoteServiceError";
  }
}

interface BaseArgs {
  /** Client acting as the signed-in user, so RLS and storage policies apply. */
  supabase: SupabaseClient;
  userId: string;
  householdId: string;
  requestId: string;
}

async function writeAudit(
  args: BaseArgs,
  noteId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Payload never contains note text or images.
  const { error } = await args.supabase.from("audit_events").insert({
    household_id: args.householdId,
    note_id: noteId,
    actor_id: args.userId,
    event_type: "note_created",
    payload,
  });
  if (error) throw new NoteServiceError("database_failed", "Could not write audit event");
}

export async function createTextNote(args: BaseArgs & { text: string }): Promise<CreateNoteResult> {
  const masked = maskSensitive(args.text);
  const noteId = randomUUID();

  const { error } = await args.supabase.from("notes").insert({
    id: noteId,
    household_id: args.householdId,
    created_by: args.userId,
    source_type: "text",
    text_content: masked.text,
  });
  if (error) throw new NoteServiceError("database_failed", "Could not save note");

  await writeAudit(args, noteId, { source_type: "text", masked_kinds: masked.kinds });
  return {
    noteId,
    ocrStatus: "skipped",
    lowConfidence: false,
    maskedKinds: masked.kinds,
    ocrMessage: null,
  };
}

export async function createImageNote(
  args: BaseArgs & {
    image: ValidatedImage;
    ocr: OcrAdapter | null;
    log?: (entry: Record<string, unknown>) => void;
  },
): Promise<CreateNoteResult> {
  const noteId = randomUUID();
  const path = `${args.householdId}/${noteId}.${extensionFor(args.image.mimeType)}`;

  const upload = await args.supabase.storage
    .from(NOTE_IMAGES_BUCKET)
    .upload(path, args.image.bytes, { contentType: args.image.mimeType, upsert: false });
  if (upload.error) throw new NoteServiceError("storage_failed", "Could not store image");

  let ocrStatus: OcrStatus = "skipped";
  let ocrMessage: string | null = null;
  let text: string | null = null;
  let confidence: number | null = null;
  let provider: string | null = null;
  let maskedKinds: SensitiveKind[] = [];

  if (!args.ocr) {
    ocrMessage = OCR_ERROR_MESSAGES.not_configured;
  } else if (!args.ocr.supports(args.image.mimeType)) {
    ocrMessage = OCR_ERROR_MESSAGES.unsupported_type;
  } else {
    provider = args.ocr.name;
    const started = Date.now();
    try {
      const result = await args.ocr.recognize({
        bytes: args.image.bytes,
        mimeType: args.image.mimeType,
      });
      if (result.text) {
        const masked = maskSensitive(result.text);
        text = masked.text;
        maskedKinds = masked.kinds;
        confidence = result.confidence;
        ocrStatus = "done";
      } else {
        ocrStatus = "no_text";
        ocrMessage = "We could not find any writing in this photo. Please check it yourself.";
      }
      args.log?.({
        requestId: args.requestId,
        provider,
        outcome: ocrStatus,
        latencyMs: Date.now() - started,
      });
    } catch (error) {
      const code = error instanceof OcrError ? error.code : "provider_error";
      ocrStatus = "failed";
      ocrMessage = OCR_ERROR_MESSAGES[code];
      args.log?.({
        requestId: args.requestId,
        provider,
        outcome: `error:${code}`,
        latencyMs: Date.now() - started,
      });
    }
  }

  const { error } = await args.supabase.from("notes").insert({
    id: noteId,
    household_id: args.householdId,
    created_by: args.userId,
    source_type: "image",
    image_path: path,
    ocr_text: text,
    ocr_confidence: confidence === null ? null : Number(confidence.toFixed(3)),
  });
  if (error) throw new NoteServiceError("database_failed", "Could not save note");

  await writeAudit(args, noteId, {
    source_type: "image",
    mime_type: args.image.mimeType,
    ocr_status: ocrStatus,
    ocr_provider: provider,
    ocr_confidence: confidence,
    masked_kinds: maskedKinds,
  });

  return {
    noteId,
    ocrStatus,
    lowConfidence: ocrStatus === "done" && isLowConfidence(confidence),
    maskedKinds,
    ocrMessage,
  };
}
