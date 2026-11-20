import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { MAX_IMAGE_BYTES, MAX_NOTE_TEXT_LENGTH, noteInputSchema } from "@/lib/schemas/note";
import { getOcrAdapter } from "@/lib/ocr";
import {
  UPLOAD_ERROR_MESSAGES,
  UploadValidationError,
  validateImageBytes,
} from "@/lib/uploads/validate";
import { NoteServiceError, createImageNote, createTextNote } from "@/server/notes/create-note";
import { getSessionContext } from "@/server/session";

export const runtime = "nodejs";

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request) {
  const requestId = randomUUID();

  const session = await getSessionContext();
  if (session.status === "unconfigured") {
    return fail(
      503,
      "unconfigured",
      "The app is not set up yet. Please ask the person who manages it.",
    );
  }
  if (session.status === "signed_out") {
    return fail(401, "signed_out", "Please sign in to add a note.");
  }
  if (session.status === "no_household") {
    return fail(403, "no_household", "You are not part of a household yet.");
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_IMAGE_BYTES + 64 * 1024) {
    return fail(413, "too_large", UPLOAD_ERROR_MESSAGES.too_large);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "bad_request", "We could not read that. Please try again.");
  }

  const common = {
    supabase: session.supabase,
    userId: session.userId,
    householdId: session.householdId,
    requestId,
  };

  try {
    const kind = form.get("kind");

    if (kind === "text") {
      const parsed = noteInputSchema.safeParse({
        householdId: session.householdId,
        sourceType: "text",
        textContent: form.get("text"),
      });
      if (!parsed.success || parsed.data.sourceType !== "text") {
        return fail(
          400,
          "invalid_text",
          `Please type or paste a note (up to ${MAX_NOTE_TEXT_LENGTH} characters).`,
        );
      }
      return NextResponse.json(await createTextNote({ ...common, text: parsed.data.textContent }));
    }

    if (kind === "image") {
      const file = form.get("file");
      if (!(file instanceof File)) {
        return fail(400, "missing_file", UPLOAD_ERROR_MESSAGES.missing_file);
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return fail(413, "too_large", UPLOAD_ERROR_MESSAGES.too_large);
      }
      const image = validateImageBytes(new Uint8Array(await file.arrayBuffer()));
      const check = noteInputSchema.safeParse({
        householdId: session.householdId,
        sourceType: "image",
        imageMimeType: image.mimeType,
        imageSizeBytes: image.sizeBytes,
      });
      if (!check.success) return fail(400, "invalid_image", UPLOAD_ERROR_MESSAGES.unsupported_type);

      return NextResponse.json(
        await createImageNote({
          ...common,
          image,
          ocr: getOcrAdapter(),
          // Metadata only. Never log OCR text or images.
          log: (entry) =>
            console.info("[ocr]", JSON.stringify({ ...entry, householdId: session.householdId })),
        }),
      );
    }

    return fail(400, "bad_request", "We could not read that. Please try again.");
  } catch (error) {
    if (error instanceof UploadValidationError) return fail(400, error.code, error.message);
    if (error instanceof NoteServiceError) {
      console.error("[notes]", JSON.stringify({ requestId, code: error.code }));
      return fail(500, error.code, "We could not save your note. Please try again.");
    }
    console.error("[notes]", JSON.stringify({ requestId, code: "unexpected" }));
    return fail(500, "unexpected", "Something went wrong. Please try again.");
  }
}
