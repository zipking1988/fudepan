import { AiandAdapter } from "./aiand";
import type { LlmAdapter } from "./types";

export * from "./types";

/** Returns the configured LLM adapter, or null when ai& is not configured. Server-side only. */
export function getLlmAdapter(env: NodeJS.ProcessEnv = process.env): LlmAdapter | null {
  const apiKey = env.AIAND_API_KEY;
  const modelId = env.AIAND_MODEL;
  if (!apiKey || !modelId || modelId.startsWith("choose-")) return null;
  return new AiandAdapter({ apiKey, modelId, baseUrl: env.AIAND_BASE_URL || undefined });
}
