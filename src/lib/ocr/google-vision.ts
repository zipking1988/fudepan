import { z } from "zod";
import { OcrError, type OcrAdapter, type OcrRequest, type OcrResult } from "./types";

/**
 * Google Cloud Vision adapter (DOCUMENT_TEXT_DETECTION).
 *
 * Third-party disclosure (safety policy item 10):
 * - Provider: Google Cloud Vision API.
 * - Purpose: read handwritten text from a note photo the user chose to upload.
 * - Data sent: the single image only. No household, member, or user identifiers.
 * - Data returned: recognized text and confidence. Text is masked before storage.
 * - Note: Vision does not support HEIC, so HEIC photos are stored but not read.
 */
const ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const SUPPORTED = ["image/jpeg", "image/png"];
const DEFAULT_TIMEOUT_MS = 15_000;

const wordSchema = z.object({ confidence: z.number().optional() });
const responseSchema = z.object({
  responses: z
    .array(
      z.object({
        error: z.object({ code: z.number().optional() }).optional(),
        fullTextAnnotation: z
          .object({
            text: z.string(),
            pages: z
              .array(
                z.object({
                  blocks: z
                    .array(
                      z.object({
                        paragraphs: z
                          .array(z.object({ words: z.array(wordSchema).optional() }))
                          .optional(),
                      }),
                    )
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

type FetchLike = typeof fetch;

export interface GoogleVisionOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

function averageWordConfidence(data: z.infer<typeof responseSchema>): number | null {
  const pages = data.responses[0]?.fullTextAnnotation?.pages ?? [];
  let sum = 0;
  let count = 0;
  for (const page of pages) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          if (typeof word.confidence === "number") {
            sum += word.confidence;
            count += 1;
          }
        }
      }
    }
  }
  return count === 0 ? null : sum / count;
}

export class GoogleVisionAdapter implements OcrAdapter {
  readonly name = "google-cloud-vision";
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: GoogleVisionOptions) {
    if (!options.apiKey) throw new OcrError("not_configured", "Missing Vision API key");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  supports(mimeType: string): boolean {
    return SUPPORTED.includes(mimeType);
  }

  async recognize(request: OcrRequest, options?: { signal?: AbortSignal }): Promise<OcrResult> {
    if (!this.supports(request.mimeType)) {
      throw new OcrError("unsupported_type", `Unsupported image type: ${request.mimeType}`);
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          requests: [
            {
              image: { content: Buffer.from(request.bytes).toString("base64") },
              features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
              imageContext: { languageHints: ["ja", "en"] },
            },
          ],
        }),
        signal,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new OcrError("timeout", "Vision request timed out");
      }
      throw new OcrError("provider_error", "Vision request failed");
    }

    if (response.status === 429) throw new OcrError("rate_limited", "Vision rate limited");
    if (!response.ok) throw new OcrError("provider_error", `Vision HTTP ${response.status}`);

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new OcrError("invalid_response", "Vision returned invalid JSON");
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new OcrError("invalid_response", "Vision response shape mismatch");

    const first = parsed.data.responses[0];
    if (first?.error) {
      throw new OcrError(
        first.error.code === 8 ? "rate_limited" : "provider_error",
        "Vision error",
      );
    }

    const text = first?.fullTextAnnotation?.text.trim() ?? "";
    return {
      text,
      confidence: text ? averageWordConfidence(parsed.data) : null,
      provider: this.name,
    };
  }
}
