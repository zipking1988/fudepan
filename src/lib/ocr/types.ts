/** Provider-neutral OCR contract. Providers live behind this interface (tech-stack steering). */
export interface OcrRequest {
  bytes: Uint8Array;
  mimeType: string;
}

export interface OcrResult {
  /** Raw recognized text. Callers must mask it before storing or showing it. */
  text: string;
  /** Average confidence from 0 to 1, or null when the provider gave none or found no text. */
  confidence: number | null;
  provider: string;
}

export interface OcrAdapter {
  readonly name: string;
  supports(mimeType: string): boolean;
  recognize(request: OcrRequest, options?: { signal?: AbortSignal }): Promise<OcrResult>;
}

export type OcrErrorCode =
  | "unsupported_type"
  | "not_configured"
  | "rate_limited"
  | "timeout"
  | "provider_error"
  | "invalid_response";

export class OcrError extends Error {
  constructor(
    public readonly code: OcrErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OcrError";
  }
}

export const OCR_ERROR_MESSAGES: Record<OcrErrorCode, string> = {
  unsupported_type:
    "We could not read the writing in this kind of photo. Your photo is saved. Please check it yourself.",
  not_configured:
    "Reading handwriting is not turned on yet. Your photo is saved. Please check it yourself.",
  rate_limited:
    "Reading handwriting is busy right now. Your photo is saved. Please try again later.",
  timeout: "Reading the photo took too long. Your photo is saved. Please try again later.",
  provider_error: "We could not read the writing. Your photo is saved. Please check it yourself.",
  invalid_response: "We could not read the writing. Your photo is saved. Please check it yourself.",
};
