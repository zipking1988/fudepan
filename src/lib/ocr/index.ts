import { GoogleVisionAdapter } from "./google-vision";
import type { OcrAdapter } from "./types";

export * from "./types";
export * from "./confidence";

/** Returns the configured OCR adapter, or null when no provider key is set. Server-side only. */
export function getOcrAdapter(env: NodeJS.ProcessEnv = process.env): OcrAdapter | null {
  const key = env.GOOGLE_CLOUD_VISION_API_KEY;
  return key ? new GoogleVisionAdapter({ apiKey: key }) : null;
}
