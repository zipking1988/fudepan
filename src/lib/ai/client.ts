import "server-only";

import { getServerEnv } from "@/lib/env/server";
import { log } from "@/lib/log";

import { careChainDraftSchema, validateCareChainDraft, normalizeCareChainDraft, type CareChainDraft } from "./schema";

/**
 * ai& client — server-only.
 *
 * Flow (from .kiro/steering/tech-stack.md):
 *   1. Upload image to ai& Files API → file_id
 *   2. Send chat completion with vision model and file_id
 *   3. Parse and Zod-validate the JSON response
 *   4. Run safety validation rules
 *
 * The API key never leaves this module and never appears in logs.
 */

export type ExtractionResult =
  | { ok: true; draft: CareChainDraft }
  | { ok: false; reason: "upload_failed" | "completion_failed" | "invalid_json" | "schema_invalid" | "safety_violation" | "model_unavailable"; detail: string };

type AiandFile = { id: string };

/**
 * Time limits for the two ai& calls. They sit below the 300 s `maxDuration` of
 * the routes that host recognition, so a hung request fails with a plain
 * reason code and the run is recorded as failed instead of being killed
 * silently. The lease on a run (see RECOGNITION_LEASE_SECONDS) is longer still.
 */
export const COMPLETION_TIMEOUT_MS = 240_000;
export const FILES_UPLOAD_TIMEOUT_MS = 60_000;

export type ExtractOptions = {
  /** Test hook. Defaults to COMPLETION_TIMEOUT_MS. */
  completionTimeoutMs?: number;
  /** Test hook. Defaults to FILES_UPLOAD_TIMEOUT_MS. */
  uploadTimeoutMs?: number;
};

/**
 * Upload image bytes to ai& Files API.
 * Returns the file_id or null on failure.
 */
async function uploadToFilesApi(
  imageBytes: Uint8Array,
  contentType: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<string | null> {
  const form = new FormData();
  form.append("purpose", "vision");
  form.append("file", new Blob([imageBytes.buffer as ArrayBuffer], { type: contentType }), "note.img");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    log("error", "aiand.files_api_network_error", { code: "fetch_threw" });
    return null;
  }

  if (!response.ok) {
    log("error", "aiand.files_api_error", { status: response.status });
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    log("error", "aiand.files_api_invalid_json");
    return null;
  }

  const fileId = (body as AiandFile)?.id;
  if (typeof fileId !== "string" || !fileId) {
    log("error", "aiand.files_api_no_id");
    return null;
  }

  return fileId;
}

const SYSTEM_PROMPT = `You are a care-coordination assistant for Fudepan.

Your job is to read a handwritten note image and extract a structured Care Chain draft.

Rules you must follow:
- Return ONLY valid JSON matching the schema below. No markdown, no commentary.
- Never diagnose a medical condition.
- Never recommend starting, stopping, or changing medication.
- Never invent dates, times, hospital names, medication names, amounts, or people.
- For due_at and escalation_at: only include an ISO 8601 datetime if you can read an explicit date AND time from the note. If only a date is visible, or if the time is unclear, leave the field null.
- In source_quote, include the complete literal date and time text as written in the note, if present.
- If information is missing or ambiguous, add it to "ambiguities" and leave the field null or empty.
- Mark high-risk steps (medical, medication, appointment, payment, transport of a person, government paperwork) with risk_level "high" AND approval_required true.
- Set confidence between 0 and 1 based on how clearly you can read the handwriting.
- Never assign a person to a step. "suggested_owner_role" is only a household role hint (for example "a family member who drives"), never a name.
- Do not guess clinic names, times, or amounts. If the note does not state them, leave them out and add an ambiguity.
- If the note says to ask someone (for example "Ask Misa which clinic"), put only that person's name (for example "Misa") in "person_to_ask" on the step the question belongs to. The person you are told to ask is NOT the owner of the step.
- If the note contains a medical question, create a separate step (care_category "medical", risk_level "high", approval_required true) to ask a qualified professional. Do not answer the question, diagnose, give a dosage, or suggest changing medication.
- Create separate steps for shopping and for picking up medicine.
- For each ambiguity, set "step_index" to the zero-based position of the related step in "steps" (or null), and "kind" to what is missing: date, time, location, person, document, amount, or contact (or null).

Required JSON schema:
{
  "chain_title": "string",
  "overall_risk": "low" | "medium" | "high",
  "steps": [
    {
      "title": "string",
      "description": "string",
      "care_category": "medical" | "medication" | "appointment" | "payment" | "transport" | "document" | "household" | "communication",
      "risk_level": "low" | "medium" | "high",
      "suggested_owner_role": "household role hint only, never a person's name",
      "person_to_ask": "name of the person the note says to ask, otherwise null",
      "due_at": "ISO 8601 datetime only if explicit date AND time are visible, otherwise null",
      "escalation_at": "ISO 8601 datetime only if explicit date AND time are visible, otherwise null",
      "evidence_required": ["string"],
      "approval_required": true or false,
      "source_quote": "complete literal date/time text from note",
      "confidence": 0.0 to 1.0
    }
  ],
  "ambiguities": [
    {
      "field": "string",
      "question": "string",
      "reason": "string",
      "step_index": zero-based index into steps, or null,
      "kind": "date" | "time" | "location" | "person" | "document" | "amount" | "contact" | null
    }
  ],
  "ai_boundary": {
    "medical_advice_requested": false,
    "blocked_actions": [],
    "explanation": "string"
  }
}`;

/**
 * Call the ai& chat completions endpoint with an uploaded file_id.
 */
async function callChatCompletions(
  fileId: string,
  model: string,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number,
): Promise<string | null> {
  const body = {
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "file",
            file: { file_id: fileId },
          },
          {
            type: "text",
            text: "Please read this handwritten note and return a Care Chain JSON draft.",
          },
        ],
      },
    ],
  };

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    log("error", "aiand.completions_network_error");
    return null;
  }

  if (!response.ok) {
    log("error", "aiand.completions_error", { status: response.status });
    return null;
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    log("error", "aiand.completions_invalid_json");
    return null;
  }

  // OpenAI-compatible response shape
  const content = (result as { choices?: { message?: { content?: string } }[] })?.choices?.[0]
    ?.message?.content;
  if (typeof content !== "string" || !content) {
    log("error", "aiand.completions_no_content");
    return null;
  }

  return content;
}

/**
 * Delete an uploaded file from ai& Files API (cleanup after extraction).
 * Best-effort; failure does not block anything.
 */
async function deleteFile(fileId: string, baseUrl: string, apiKey: string): Promise<void> {
  try {
    await fetch(`${baseUrl}/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // best-effort cleanup
  }
}

/**
 * Extract a Care Chain draft from an image.
 *
 * @param imageBytes - raw image bytes
 * @param contentType - MIME type of the image
 */
export async function extractCareChain(
  imageBytes: Uint8Array,
  contentType: string,
  options: ExtractOptions = {},
): Promise<ExtractionResult> {
  const env = getServerEnv();
  const { AIAND_API_KEY, AIAND_BASE_URL, AIAND_MODEL } = env;

  if (!AIAND_API_KEY || !AIAND_BASE_URL || !AIAND_MODEL) {
    return {
      ok: false,
      reason: "model_unavailable",
      detail:
        "AI extraction is not configured. Set AIAND_API_KEY, AIAND_BASE_URL, and AIAND_MODEL in your environment.",
    };
  }

  // 1. Upload image to Files API
  const fileId = await uploadToFilesApi(imageBytes, contentType, AIAND_BASE_URL, AIAND_API_KEY, options.uploadTimeoutMs ?? FILES_UPLOAD_TIMEOUT_MS);
  if (!fileId) {
    return { ok: false, reason: "upload_failed", detail: "Could not upload image to ai& Files API" };
  }

  // 2. Call chat completions
  const rawContent = await callChatCompletions(
    fileId,
    AIAND_MODEL,
    AIAND_BASE_URL,
    AIAND_API_KEY,
    options.completionTimeoutMs ?? COMPLETION_TIMEOUT_MS,
  );

  // 3. Clean up uploaded file (best-effort, after getting the content)
  void deleteFile(fileId, AIAND_BASE_URL, AIAND_API_KEY);

  if (!rawContent) {
    return { ok: false, reason: "completion_failed", detail: "ai& did not return a response" };
  }

  // 4. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    log("error", "aiand.draft_json_parse_failed");
    return { ok: false, reason: "invalid_json", detail: "ai& returned text that is not valid JSON" };
  }

  // 5. Validate schema with Zod
  const validated = careChainDraftSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues.map((i) => i.message).join("; ");
    log("error", "aiand.draft_schema_invalid");
    return {
      ok: false,
      reason: "schema_invalid",
      detail: `Draft does not match required schema: ${issues}`,
    };
  }

  // 6. Normalize: remove unsupported timestamps (AI-invented times)
  const normalized = normalizeCareChainDraft(validated.data);

  // 7. Safety validation (after normalization)
  const violations = validateCareChainDraft(normalized);
  if (violations.length > 0) {
    log("error", "aiand.draft_safety_violation", { count: violations.length });
    return {
      ok: false,
      reason: "safety_violation",
      detail: violations.join(" | "),
    };
  }

  return { ok: true, draft: normalized };
}
