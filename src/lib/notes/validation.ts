import { MAX_NOTE_BYTES, isNoteContentType, type NoteContentType } from "./rules";

/** Bytes needed to recognise every accepted format. */
export const NOTE_SIGNATURE_BYTES = 16;

export type NoteFileProblem =
  "no_file" | "empty" | "too_large" | "unsupported_type" | "not_an_image";

export type NoteFileCheck =
  | { ok: true; contentType: NoteContentType }
  | { ok: false; problem: NoteFileProblem; message: string };

type FileFacts = { type: string; size: number };

/**
 * Identifies JPEG, PNG, and WebP from their first bytes. The file's name and
 * the type the browser reports are only hints; the content decides.
 */
export function sniffNoteImageType(head: Uint8Array): NoteContentType | null {
  const startsWith = (bytes: number[], offset = 0) =>
    head.length >= offset + bytes.length && bytes.every((b, i) => head[offset + i] === b);

  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF" <size> "WEBP"
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

/** "2.4 MB", "640 KB", "12 bytes". Uses 1 MB = 1,048,576 bytes, like the limit. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1).replace(/\.0$/, "")} MB`;
}

const TYPE_DESCRIPTIONS: Record<string, string> = {
  "image/heic": "an iPhone HEIC photo",
  "image/heif": "an iPhone HEIF photo",
  "image/gif": "a GIF image",
  "image/bmp": "a BMP image",
  "image/tiff": "a TIFF image",
  "image/svg+xml": "an SVG drawing",
  "image/avif": "an AVIF image",
  "application/pdf": "a PDF document",
};

const HEIC_HINT =
  " On an iPhone, open Settings, then Camera, then Formats, and choose Most Compatible. Then take the photo again.";

function unsupportedTypeMessage(type: string): string {
  const description = TYPE_DESCRIPTIONS[type.toLowerCase()];
  const what = description ? `This file is ${description}.` : "This file is not one of those.";
  const hint = /^image\/hei[cf]$/i.test(type) ? HEIC_HINT : "";
  return `Fudepan accepts photos saved as JPEG, PNG, or WebP. ${what}${hint}`;
}

const MESSAGES = {
  no_file: () => "Choose a photo of the note first.",
  empty: () => "This file is empty. Choose a photo of the note.",
  too_large: (size: number) =>
    `This photo is ${formatFileSize(size)}. The limit is 10 MB. Crop the photo or take it again with a smaller size, then choose it here.`,
  not_an_image: () =>
    "This file doesn't look like a JPEG, PNG, or WebP photo. Choose a photo of the note.",
} as const;

export function noteFileMessage(problem: NoteFileProblem, facts?: Partial<FileFacts>): string {
  switch (problem) {
    case "unsupported_type":
      return unsupportedTypeMessage(facts?.type ?? "");
    case "too_large":
      return MESSAGES.too_large(facts?.size ?? 0);
    default:
      return MESSAGES[problem]();
  }
}

function fail(problem: NoteFileProblem, facts?: Partial<FileFacts>): NoteFileCheck {
  return { ok: false, problem, message: noteFileMessage(problem, facts) };
}

/**
 * Checks what can be known before reading the file: size and declared type.
 * The server runs this on the values the browser sends.
 */
export function checkDeclaredNoteFile(facts: FileFacts): NoteFileCheck {
  if (facts.size <= 0) return fail("empty", facts);
  if (facts.size > MAX_NOTE_BYTES) return fail("too_large", facts);
  if (!isNoteContentType(facts.type)) return fail("unsupported_type", facts);
  return { ok: true, contentType: facts.type };
}

/**
 * Full browser-side check: size, then the file's real content. The content
 * decides the type; the browser's reported type only picks the error message
 * (so a HEIC photo gets advice about HEIC).
 */
export function checkNoteFile(facts: FileFacts, head: Uint8Array): NoteFileCheck {
  if (facts.size <= 0) return fail("empty", facts);
  if (facts.size > MAX_NOTE_BYTES) return fail("too_large", facts);

  const sniffed = sniffNoteImageType(head);
  if (sniffed) return { ok: true, contentType: sniffed };

  const declared = facts.type.toLowerCase();
  return declared && !isNoteContentType(declared)
    ? fail("unsupported_type", facts)
    : fail("not_an_image", facts);
}
