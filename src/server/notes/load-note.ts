import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOTE_IMAGES_BUCKET } from "@/server/notes/create-note";

export interface LoadedNote {
  id: string;
  sourceType: "image" | "text";
  /** Masked OCR text for photos, masked typed text for text notes. */
  text: string | null;
  ocrConfidence: number | null;
  imageUrl: string | null;
  mimeExt: string | null;
}

const SIGNED_URL_SECONDS = 300;

/**
 * Loads a note through the user's RLS-bound client. Notes outside the user's households return
 * null. The photo is only reachable through a 5-minute signed URL.
 */
export async function loadNote(supabase: SupabaseClient, id: string): Promise<LoadedNote | null> {
  const { data: note } = await supabase
    .from("notes")
    .select("id, source_type, text_content, image_path, ocr_text, ocr_confidence")
    .eq("id", id)
    .maybeSingle();
  if (!note) return null;

  const isImage = note.source_type === "image";
  let imageUrl: string | null = null;
  if (isImage && note.image_path) {
    const { data } = await supabase.storage
      .from(NOTE_IMAGES_BUCKET)
      .createSignedUrl(note.image_path as string, SIGNED_URL_SECONDS);
    imageUrl = data?.signedUrl ?? null;
  }
  return {
    id: note.id as string,
    sourceType: isImage ? "image" : "text",
    text: ((isImage ? note.ocr_text : note.text_content) as string | null) ?? null,
    ocrConfidence: note.ocr_confidence === null ? null : Number(note.ocr_confidence),
    imageUrl,
    mimeExt: (note.image_path as string | null)?.split(".").pop() ?? null,
  };
}
