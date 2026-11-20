import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/schemas/note";

export type ImageMimeType = (typeof ALLOWED_IMAGE_TYPES)[number];

export type UploadErrorCode = "missing_file" | "empty_file" | "too_large" | "unsupported_type";

export class UploadValidationError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "UploadValidationError";
  }
}

const HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"];

/** Detects the real image type from file bytes. The browser-supplied type is not trusted. */
export function detectImageType(bytes: Uint8Array): ImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  ) {
    return "image/png";
  }
  if (bytes.length >= 12) {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
    if (ascii(4, 8) === "ftyp" && HEIF_BRANDS.includes(ascii(8, 12))) return "image/heic";
  }
  return null;
}

export interface ValidatedImage {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
  sizeBytes: number;
}

export const UPLOAD_ERROR_MESSAGES: Record<UploadErrorCode, string> = {
  missing_file: "Please choose a photo first.",
  empty_file: "That file looks empty. Please choose another photo.",
  too_large: "That photo is too big. Please choose one smaller than 10 MB.",
  unsupported_type: "We can only use JPG, PNG, or HEIC photos. Please choose a different file.",
};

export function validateImageBytes(bytes: Uint8Array): ValidatedImage {
  if (bytes.length === 0) {
    throw new UploadValidationError("empty_file", UPLOAD_ERROR_MESSAGES.empty_file);
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new UploadValidationError("too_large", UPLOAD_ERROR_MESSAGES.too_large);
  }
  const mimeType = detectImageType(bytes);
  if (!mimeType) {
    throw new UploadValidationError("unsupported_type", UPLOAD_ERROR_MESSAGES.unsupported_type);
  }
  return { bytes, mimeType, sizeBytes: bytes.length };
}

const EXTENSIONS: Record<ImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heic",
};

export function extensionFor(mimeType: ImageMimeType): string {
  return EXTENSIONS[mimeType];
}

/** Quick check for the browser using only size and file name, before sending anything. */
export function checkFileClientSide(file: { size: number; name: string; type: string }) {
  if (file.size === 0) return UPLOAD_ERROR_MESSAGES.empty_file;
  if (file.size > MAX_IMAGE_BYTES) return UPLOAD_ERROR_MESSAGES.too_large;
  const okType = (ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type);
  const okName = /\.(jpe?g|png|heic|heif)$/i.test(file.name);
  if (!okType && !okName) return UPLOAD_ERROR_MESSAGES.unsupported_type;
  return null;
}
