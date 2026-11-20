import { describe, expect, it, vi } from "vitest";
import { GoogleVisionAdapter } from "@/lib/ocr/google-vision";
import { OcrError } from "@/lib/ocr/types";
import { getOcrAdapter } from "@/lib/ocr";
import { isLowConfidence, confidencePercent } from "@/lib/ocr/confidence";

const bytes = new Uint8Array([1, 2, 3]);
const ok = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

function adapter(fetchImpl: typeof fetch, timeoutMs?: number) {
  return new GoogleVisionAdapter({ apiKey: "test-key", fetchImpl, timeoutMs });
}

const sample = {
  responses: [
    {
      fullTextAnnotation: {
        text: "Buy milk\n",
        pages: [
          {
            blocks: [{ paragraphs: [{ words: [{ confidence: 0.9 }, { confidence: 0.7 }, {}] }] }],
          },
        ],
      },
    },
  ],
};

describe("GoogleVisionAdapter", () => {
  it("returns trimmed text and average word confidence", async () => {
    const fetchImpl = vi.fn(() => ok(sample)) as unknown as typeof fetch;
    const result = await adapter(fetchImpl).recognize({ bytes, mimeType: "image/png" });
    expect(result).toEqual({ text: "Buy milk", confidence: 0.8, provider: "google-cloud-vision" });
  });

  it("sends only the image, with the key in a header and not in the URL", async () => {
    const fetchImpl = vi.fn(() => ok(sample)) as unknown as typeof fetch;
    await adapter(fetchImpl).recognize({ bytes, mimeType: "image/jpeg" });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body.requests[0]).sort()).toEqual(["features", "image", "imageContext"]);
  });

  it("returns empty text and null confidence when no writing is found", async () => {
    const fetchImpl = (() => ok({ responses: [{}] })) as unknown as typeof fetch;
    const result = await adapter(fetchImpl).recognize({ bytes, mimeType: "image/png" });
    expect(result.text).toBe("");
    expect(result.confidence).toBeNull();
  });

  it("does not support HEIC and refuses without calling the provider", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const a = adapter(fetchImpl);
    expect(a.supports("image/heic")).toBe(false);
    await expect(a.recognize({ bytes, mimeType: "image/heic" })).rejects.toMatchObject({
      code: "unsupported_type",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [429, "rate_limited"],
    [500, "provider_error"],
    [403, "provider_error"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const fetchImpl = (() => ok({}, status)) as unknown as typeof fetch;
    await expect(
      adapter(fetchImpl).recognize({ bytes, mimeType: "image/png" }),
    ).rejects.toMatchObject({ code });
  });

  it("maps a provider error payload", async () => {
    const fetchImpl = (() =>
      ok({ responses: [{ error: { code: 3 } }] })) as unknown as typeof fetch;
    await expect(
      adapter(fetchImpl).recognize({ bytes, mimeType: "image/png" }),
    ).rejects.toMatchObject({
      code: "provider_error",
    });
  });

  it("rejects malformed responses", async () => {
    const fetchImpl = (() => ok({ nope: true })) as unknown as typeof fetch;
    await expect(
      adapter(fetchImpl).recognize({ bytes, mimeType: "image/png" }),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
    const notJson = (() =>
      Promise.resolve(new Response("<html>", { status: 200 }))) as unknown as typeof fetch;
    await expect(
      adapter(notJson).recognize({ bytes, mimeType: "image/png" }),
    ).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("maps network failure and timeout without leaking details", async () => {
    const down = (() => Promise.reject(new Error("secret host detail"))) as unknown as typeof fetch;
    const err = await adapter(down)
      .recognize({ bytes, mimeType: "image/png" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(OcrError);
    expect(err.code).toBe("provider_error");
    expect(err.message).not.toContain("secret");

    const slow = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    await expect(
      adapter(slow, 20).recognize({ bytes, mimeType: "image/png" }),
    ).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("requires an API key", () => {
    expect(() => new GoogleVisionAdapter({ apiKey: "" })).toThrowError(OcrError);
  });
});

describe("getOcrAdapter", () => {
  it("returns null without a key and an adapter with one", () => {
    expect(getOcrAdapter({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      getOcrAdapter({ GOOGLE_CLOUD_VISION_API_KEY: "k" } as unknown as NodeJS.ProcessEnv)?.name,
    ).toBe("google-cloud-vision");
  });
});

describe("confidence helpers", () => {
  it("treats unknown and below-threshold values as low", () => {
    expect(isLowConfidence(null)).toBe(true);
    expect(isLowConfidence(0.79)).toBe(true);
    expect(isLowConfidence(0.8)).toBe(false);
    expect(confidencePercent(0.876)).toBe(88);
  });
});
