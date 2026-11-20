import { z } from "zod";
import {
  LlmError,
  type LlmAdapter,
  type LlmCompletion,
  type LlmJsonRequest,
  type LlmUsage,
} from "./types";

/**
 * ai& (aiand.com) adapter, OpenAI-compatible Chat Completions over fetch.
 *
 * Third-party disclosure (safety policy item 10):
 * - Provider: ai& (https://api.aiand.com). Purpose: turn a household note into a draft task.
 * - Data sent: masked note text, OCR confidence, reference date and time zone. The note photo is
 *   attached only when the caller decides it is needed (OCR empty or low confidence, no sensitive
 *   values detected, JPEG or PNG). No household, member, or user identifiers are sent.
 * - Photos go through the Files API, are referenced by file_id, and are deleted right after the
 *   request (ai& keeps files 30 days otherwise). Organizations on zero data retention refuse
 *   uploads, so the photo is sent inline instead, which ai& does not store.
 * - The API key stays on the server. Error messages never include prompts, responses or keys.
 */

const DEFAULT_BASE_URL = "https://api.aiand.com/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const VISION_TYPES = ["image/jpeg", "image/png"];
const MODEL_CACHE_MS = 10 * 60_000;

const modelListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      capabilities: z.array(z.string()).optional(),
      reasoning_efforts: z.array(z.string()).nullable().optional(),
    }),
  ),
});
type ModelInfo = z.infer<typeof modelListSchema>["data"][number];

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      total_tokens: z.number().optional(),
      completion_tokens_details: z.object({ reasoning_tokens: z.number().optional() }).optional(),
    })
    .optional(),
});

export interface AiandOptions {
  apiKey: string;
  modelId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export class AiandAdapter implements LlmAdapter {
  readonly provider = "aiand";
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private modelCache: { at: number; info: ModelInfo | null } | null = null;

  constructor(options: AiandOptions) {
    if (!options.apiKey || !options.modelId) {
      throw new LlmError("not_configured", "Missing ai& configuration");
    }
    this.apiKey = options.apiKey;
    this.modelId = options.modelId;
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  supportsImageType(mimeType: string): boolean {
    return VISION_TYPES.includes(mimeType);
  }

  async supportsVision(): Promise<boolean> {
    const info = await this.modelInfo();
    return Boolean(info?.capabilities?.includes("vision"));
  }

  /** Looks up the configured model in GET /models. Returns null if unknown or unreachable. */
  private async modelInfo(): Promise<ModelInfo | null> {
    if (this.modelCache && Date.now() - this.modelCache.at < MODEL_CACHE_MS) {
      return this.modelCache.info;
    }
    let info: ModelInfo | null = null;
    try {
      const res = await this.request("/models", { method: "GET" });
      if (res.ok) {
        const parsed = modelListSchema.safeParse(await res.json());
        if (parsed.success) info = parsed.data.data.find((m) => m.id === this.modelId) ?? null;
      }
    } catch {
      info = null;
    }
    this.modelCache = { at: Date.now(), info };
    return info;
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.apiKey}`);
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.request(path, init);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new LlmError("timeout", "ai& request timed out");
      }
      throw new LlmError("provider_error", "ai& request failed");
    }
  }

  private static statusToError(status: number): LlmError {
    if (status === 429) return new LlmError("rate_limited", "ai& rate limited");
    if (status === 402) return new LlmError("insufficient_credits", "ai& credits exhausted");
    if (status === 504) return new LlmError("timeout", "ai& timed out");
    return new LlmError("provider_error", `ai& HTTP ${status}`);
  }

  /** Uploads the photo and returns its file_id, or null if the org refuses uploads (zero retention). */
  private async uploadImage(bytes: Uint8Array, mimeType: string): Promise<string | null> {
    const form = new FormData();
    form.set("purpose", "vision");
    form.set(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      mimeType === "image/png" ? "note.png" : "note.jpg",
    );
    const res = await this.send("/files", { method: "POST", body: form });
    if (res.status === 403) return null;
    if (!res.ok) throw AiandAdapter.statusToError(res.status);
    const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
    if (!json || typeof json.id !== "string")
      throw new LlmError("invalid_response", "ai& file response");
    return json.id;
  }

  private async deleteFile(fileId: string): Promise<void> {
    try {
      await this.send(`/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
    } catch {
      // Best effort. Files also expire on their own.
    }
  }

  async completeJson(request: LlmJsonRequest): Promise<LlmCompletion> {
    const info = await this.modelInfo();
    let fileId: string | null = null;
    let imagePart: Record<string, unknown> | null = null;

    if (request.image) {
      if (
        !this.supportsImageType(request.image.mimeType) ||
        !info?.capabilities?.includes("vision")
      ) {
        throw new LlmError("provider_error", "Image not supported by configured model");
      }
      fileId = await this.uploadImage(request.image.bytes, request.image.mimeType);
      imagePart = fileId
        ? { type: "file", file: { file_id: fileId } }
        : {
            type: "image_url",
            image_url: {
              url: `data:${request.image.mimeType};base64,${toBase64(request.image.bytes)}`,
            },
          };
    }

    try {
      const userContent = imagePart
        ? [{ type: "text", text: request.user }, imagePart]
        : request.user;
      const lowestEffort = info?.reasoning_efforts?.includes("none")
        ? "none"
        : (info?.reasoning_efforts?.[0] ?? undefined);

      const build = (mode: "json_schema" | "json_object") =>
        JSON.stringify({
          model: this.modelId,
          temperature: 0,
          max_completion_tokens: 4000,
          ...(lowestEffort ? { reasoning_effort: lowestEffort } : {}),
          messages: [
            {
              role: "system",
              content:
                mode === "json_object"
                  ? `${request.system}\n\nReturn JSON that matches this JSON Schema exactly:\n${JSON.stringify(request.jsonSchema)}`
                  : request.system,
            },
            { role: "user", content: userContent },
          ],
          response_format:
            mode === "json_schema"
              ? {
                  type: "json_schema",
                  json_schema: {
                    name: request.schemaName,
                    strict: true,
                    schema: request.jsonSchema,
                  },
                }
              : { type: "json_object" },
        });

      const post = (mode: "json_schema" | "json_object") =>
        this.send("/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: build(mode),
        });

      let mode: "json_schema" | "json_object" = "json_schema";
      let res = await post(mode);
      if (res.status === 400) {
        // The model may not accept json_schema. Retry once with json_object (schema is in the prompt).
        mode = "json_object";
        res = await post(mode);
      }
      if (!res.ok) throw AiandAdapter.statusToError(res.status);

      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new LlmError("invalid_response", "ai& returned invalid JSON");
      }
      const parsed = completionSchema.safeParse(json);
      if (!parsed.success) throw new LlmError("invalid_response", "ai& response shape mismatch");

      const choice = parsed.data.choices[0]!;
      const content = choice.message.content?.trim() ?? "";
      if (!content || choice.finish_reason === "length") {
        throw new LlmError("invalid_response", "ai& response empty or truncated");
      }

      const u = parsed.data.usage;
      const usage: LlmUsage = {
        promptTokens: u?.prompt_tokens ?? null,
        completionTokens: u?.completion_tokens ?? null,
        totalTokens: u?.total_tokens ?? null,
        reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? null,
      };
      return { content, usage, responseMode: mode, imageSent: imagePart !== null };
    } finally {
      if (fileId) await this.deleteFile(fileId);
    }
  }
}
