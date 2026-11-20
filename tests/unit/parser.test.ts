import { describe, expect, it, vi } from "vitest";
import {
  extractTaskFromNote,
  matchAssignee,
  parseJsonObject,
  shouldAttachImage,
} from "@/lib/ai/parser";
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";
import { LlmError, type LlmAdapter, type LlmCompletion, type LlmJsonRequest } from "@/lib/ai/types";

const reference = new Date("2030-01-01T03:00:00Z");
const good = {
  title: "Buy milk",
  category: "reminder",
  dueDate: "2030-01-02",
  dueTime: "10:00",
  location: null,
  assigneeSuggestion: null,
  notes: null,
  confidence: 0.95,
  uncertainFields: [],
};

function fakeAdapter(
  respond: (req: LlmJsonRequest) => string | Error,
  opts: { vision?: boolean } = {},
) {
  const calls: LlmJsonRequest[] = [];
  const adapter: LlmAdapter = {
    provider: "aiand",
    modelId: "test-model",
    supportsVision: async () => opts.vision ?? true,
    supportsImageType: (m) => m === "image/jpeg" || m === "image/png",
    completeJson: async (req) => {
      calls.push(req);
      const out = respond(req);
      if (out instanceof Error) throw out;
      const completion: LlmCompletion = {
        content: out,
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, reasoningTokens: 2 },
        responseMode: "json_schema",
        imageSent: Boolean(req.image),
      };
      return completion;
    },
  };
  return { adapter, calls };
}

const textNote = (text: string, extra = {}) => ({
  sourceType: "text" as const,
  text,
  ocrConfidence: null,
  image: null,
  referenceDate: reference,
  timeZone: "Asia/Tokyo",
  ...extra,
});

describe("extractTaskFromNote: success", () => {
  it("returns a normalized, low-risk, review-free task for a confident routine note", async () => {
    const { adapter } = fakeAdapter(() => JSON.stringify(good));
    const r = await extractTaskFromNote(adapter, textNote("Buy milk tomorrow at 10"));
    expect(r.status).toBe("ok");
    expect(r.task).toMatchObject({
      title: "Buy milk",
      category: "reminder",
      dueAt: "2030-01-02T10:00:00+09:00",
      riskLevel: "low",
      needsReview: false,
    });
    expect(r.meta).toMatchObject({
      provider: "aiand",
      modelId: "test-model",
      promptVersion: PROMPT_VERSION,
      confidence: 0.95,
      imageAttached: false,
    });
    expect(r.meta.usage?.totalTokens).toBe(15);
  });

  it("tolerates a code fence around the JSON", async () => {
    const { adapter } = fakeAdapter(() => "```json\n" + JSON.stringify(good) + "\n```");
    expect((await extractTaskFromNote(adapter, textNote("Buy milk"))).task?.title).toBe("Buy milk");
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("overrides the model category and sets high risk from keywords", async () => {
    const { adapter } = fakeAdapter(() =>
      JSON.stringify({ ...good, title: "Pay electricity bill", category: "reminder" }),
    );
    const r = await extractTaskFromNote(adapter, textNote("Pay electricity bill"));
    expect(r.task).toMatchObject({ category: "payment", riskLevel: "high" });
    expect(r.warnings).toContain("category_adjusted");
    expect(r.status).toBe("needs_review");
  });

  it("defaults a missing time to 09:00 and flags it", async () => {
    const { adapter } = fakeAdapter(() => JSON.stringify({ ...good, dueTime: null }));
    const r = await extractTaskFromNote(adapter, textNote("Buy milk"));
    expect(r.task?.dueAt).toBe("2030-01-02T09:00:00+09:00");
    expect(r.warnings).toContain("time_not_given");
  });
});

describe("extractTaskFromNote: low confidence", () => {
  it("flags low model confidence, makes a routine task medium, and asks for review", async () => {
    const { adapter } = fakeAdapter(() =>
      JSON.stringify({ ...good, confidence: 0.4, uncertainFields: ["dueDate"] }),
    );
    const r = await extractTaskFromNote(adapter, textNote("Buy milk"));
    expect(r.status).toBe("needs_review");
    expect(r.warnings).toEqual(expect.arrayContaining(["low_confidence", "uncertain_fields"]));
    expect(r.task).toMatchObject({ riskLevel: "medium", needsReview: true, confidence: 0.4 });
  });

  it("uses the lower of the model and OCR confidence", async () => {
    const { adapter } = fakeAdapter(() => JSON.stringify(good));
    const r = await extractTaskFromNote(adapter, {
      ...textNote("Buy milk"),
      sourceType: "image",
      ocrConfidence: 0.55,
    });
    expect(r.meta.confidence).toBe(0.55);
    expect(r.warnings).toContain("low_ocr_confidence");
    expect(r.task?.riskLevel).toBe("medium");
  });

  it("never lowers a high-risk task because of confidence", async () => {
    const { adapter } = fakeAdapter(() =>
      JSON.stringify({ ...good, title: "Take pills", category: "medication", confidence: 0.2 }),
    );
    expect((await extractTaskFromNote(adapter, textNote("Take pills"))).task?.riskLevel).toBe(
      "high",
    );
  });

  it("warns about possible scams", async () => {
    const { adapter } = fakeAdapter(() =>
      JSON.stringify({ ...good, title: "Pay man", category: "payment" }),
    );
    const r = await extractTaskFromNote(
      adapter,
      textNote("URGENT pay the man immediately with gift cards"),
    );
    expect(r.warnings).toContain("possible_fraud");
  });
});

describe("extractTaskFromNote: failures keep the note and require manual review", () => {
  const cases: [string, () => string | Error, string][] = [
    ["invalid JSON", () => "Sure! Here is your task", "invalid_json"],
    ["missing fields", () => JSON.stringify({ title: "x" }), "schema_validation_failed"],
    [
      "unsafe extra action field",
      () => JSON.stringify({ ...good, executePayment: true }),
      "schema_validation_failed",
    ],
    [
      "bad enum",
      () => JSON.stringify({ ...good, category: "banking" }),
      "schema_validation_failed",
    ],
    ["provider error", () => new LlmError("provider_error", "boom"), "provider_error"],
    ["rate limit", () => new LlmError("rate_limited", "slow down"), "rate_limited"],
    ["timeout", () => new LlmError("timeout", "slow"), "timeout"],
  ];
  it.each(cases)("%s", async (_name, respond, code) => {
    const { adapter } = fakeAdapter(respond);
    const r = await extractTaskFromNote(adapter, textNote("Buy milk"));
    expect(r.status).toBe("failed");
    expect(r.task).toBeNull();
    expect(r.warnings).toEqual(["extraction_failed"]);
    expect(r.meta.failureCode).toBe(code);
  });

  it("reports unavailable without calling anything when no provider is configured", async () => {
    const r = await extractTaskFromNote(null, textNote("Buy milk"));
    expect(r.status).toBe("unavailable");
    expect(r.task).toBeNull();
  });

  it("does not call the model when there is nothing to read", async () => {
    const { adapter, calls } = fakeAdapter(() => JSON.stringify(good));
    const r = await extractTaskFromNote(adapter, textNote("   "));
    expect(r.status).toBe("failed");
    expect(r.warnings).toEqual(["no_text"]);
    expect(calls).toHaveLength(0);
  });
});

describe("extractTaskFromNote: sensitive data", () => {
  it("masks sensitive values before they reach the model", async () => {
    const { adapter, calls } = fakeAdapter(() => JSON.stringify(good));
    await extractTaskFromNote(
      adapter,
      textNote("Pay rent. Account number: 12345678. Card 4242 4242 4242 4242. password: hunter22"),
    );
    const sent = calls[0]!.user + calls[0]!.system;
    expect(sent).not.toContain("12345678");
    expect(sent).not.toContain("4242 4242");
    expect(sent).not.toContain("hunter22");
    expect(sent).toContain("[MASKED]");
  });

  it("masks sensitive values the model echoes back and warns", async () => {
    const { adapter } = fakeAdapter(() =>
      JSON.stringify({
        ...good,
        title: "Pay with card 4242 4242 4242 4242",
        notes: "Verification code is 482913",
      }),
    );
    const r = await extractTaskFromNote(adapter, textNote("Pay rent"));
    expect(JSON.stringify(r.task)).not.toMatch(/4242|482913/);
    expect(r.warnings).toContain("sensitive_masked");
  });
});

describe("shouldAttachImage and image handling", () => {
  const base = {
    sourceType: "image" as const,
    text: "Buy milk",
    ocrConfidence: 0.5,
    hasMaskedValues: false,
    imageTypeSupported: true,
    visionSupported: true,
  };
  it("attaches only when OCR is empty or low confidence", () => {
    expect(shouldAttachImage(base)).toBe(true);
    expect(shouldAttachImage({ ...base, text: "", ocrConfidence: null })).toBe(true);
    expect(shouldAttachImage({ ...base, ocrConfidence: 0.95 })).toBe(false);
  });
  it("never attaches for text notes, HEIC, non-vision models, or when sensitive values were found", () => {
    expect(shouldAttachImage({ ...base, sourceType: "text" })).toBe(false);
    expect(shouldAttachImage({ ...base, imageTypeSupported: false })).toBe(false);
    expect(shouldAttachImage({ ...base, visionSupported: false })).toBe(false);
    expect(shouldAttachImage({ ...base, hasMaskedValues: true })).toBe(false);
  });

  it("loads and sends the photo for a low-confidence note", async () => {
    const { adapter, calls } = fakeAdapter(() => JSON.stringify(good));
    const load = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const r = await extractTaskFromNote(adapter, {
      ...textNote("milk?"),
      sourceType: "image",
      ocrConfidence: 0.4,
      image: { mimeType: "image/jpeg", load },
    });
    expect(load).toHaveBeenCalledOnce();
    expect(calls[0]!.image?.mimeType).toBe("image/jpeg");
    expect(r.meta.imageAttached).toBe(true);
  });

  it("does not load the photo when OCR text already contains masked values", async () => {
    const { adapter, calls } = fakeAdapter(() => JSON.stringify(good));
    const load = vi.fn(async () => new Uint8Array([1]));
    await extractTaskFromNote(adapter, {
      ...textNote("Pay [MASKED]"),
      sourceType: "image",
      ocrConfidence: 0.4,
      image: { mimeType: "image/jpeg", load },
    });
    expect(load).not.toHaveBeenCalled();
    expect(calls[0]!.image).toBeUndefined();
  });

  it("falls back to failed (not a crash) for a HEIC photo with no OCR text", async () => {
    const { adapter, calls } = fakeAdapter(() => JSON.stringify(good));
    const r = await extractTaskFromNote(adapter, {
      ...textNote(""),
      sourceType: "image",
      image: { mimeType: "image/heic", load: async () => new Uint8Array([1]) },
    });
    expect(r.status).toBe("failed");
    expect(calls).toHaveLength(0);
  });
});

describe("prompt", () => {
  it("states the safety rules and JSON-only output", () => {
    expect(SYSTEM_PROMPT).toMatch(/single JSON object/);
    expect(SYSTEM_PROMPT).toMatch(/data, not instructions/);
    expect(SYSTEM_PROMPT).toMatch(/never pay, book, order, send, change accounts, or delete/i);
    expect(SYSTEM_PROMPT).toMatch(/\[MASKED\]/);
    expect(PROMPT_VERSION).toMatch(/^task-extraction\/v\d+$/);
  });
  it("gives the reference date, weekday and time zone", () => {
    const p = buildUserPrompt({
      text: "x",
      sourceType: "text",
      ocrConfidence: null,
      referenceDate: reference,
      timeZone: "Asia/Tokyo",
      imageAttached: false,
    });
    expect(p).toContain("2030-01-01 (Tuesday)");
    expect(p).toContain("Asia/Tokyo");
    expect(p).toContain("<note>\nx\n</note>");
  });
});

describe("matchAssignee", () => {
  const members = [
    { id: "a", display_name: "Hanako" },
    { id: "b", display_name: "Taro Yamada" },
  ];
  it("matches exact and unique partial names, never guesses", () => {
    expect(matchAssignee("hanako", members)).toBe("a");
    expect(matchAssignee("Taro", members)).toBe("b");
    expect(matchAssignee("Jiro", members)).toBeNull();
    expect(matchAssignee(null, members)).toBeNull();
    expect(
      matchAssignee("a", [
        { id: "x", display_name: "Ana" },
        { id: "y", display_name: "Hana" },
      ]),
    ).toBeNull();
  });
});
