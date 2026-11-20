/** Provider-neutral LLM contract. Providers live behind this interface (tech-stack steering). */
export interface LlmImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface LlmJsonRequest {
  system: string;
  user: string;
  image?: LlmImage;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  reasoningTokens: number | null;
}

export interface LlmCompletion {
  /** Raw model text. Must be validated with Zod before use. Never log it. */
  content: string;
  usage: LlmUsage;
  responseMode: "json_schema" | "json_object";
  imageSent: boolean;
}

export interface LlmAdapter {
  readonly provider: string;
  /** Configured model ID (from environment, never hard-coded). */
  readonly modelId: string;
  /** True only when the configured model is known to accept images. */
  supportsVision(): Promise<boolean>;
  /** Image types the provider can read (HEIC is not one of them). */
  supportsImageType(mimeType: string): boolean;
  completeJson(request: LlmJsonRequest): Promise<LlmCompletion>;
}

export type LlmErrorCode =
  | "not_configured"
  | "rate_limited"
  | "insufficient_credits"
  | "timeout"
  | "provider_error"
  | "invalid_response";

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
