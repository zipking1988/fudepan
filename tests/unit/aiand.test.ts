import { describe, expect, it, vi } from "vitest";
import { AiandAdapter } from "@/lib/ai/aiand";
import { getLlmAdapter, LlmError } from "@/lib/ai";

const KEY = "sk-test-secret-key";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const models = (
  caps: string[] = ["vision", "reasoning"],
  efforts: string[] | null = ["low", "high", "max"],
) => json({ data: [{ id: "test/model", capabilities: caps, reasoning_efforts: efforts }] });
const completion = (content = '{"ok":true}', extra = {}) =>
  json({
    choices: [{ finish_reason: "stop", message: { content } }],
    usage: {
      prompt_tokens: 7,
      completion_tokens: 3,
      total_tokens: 10,
      completion_tokens_details: { reasoning_tokens: 1 },
    },
    ...extra,
  });

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
function make(handler: Handler, opts: { timeoutMs?: number } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as unknown as typeof fetch;
  const adapter = new AiandAdapter({ apiKey: KEY, modelId: "test/model", fetchImpl, ...opts });
  return { adapter, calls };
}
const req = { system: "sys", user: "usr", schemaName: "t", jsonSchema: { type: "object" } };
const image = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };
const bodyOf = (c: { init: RequestInit }) => JSON.parse(c.init.body as string);

describe("AiandAdapter text requests", () => {
  it("posts to /chat/completions with bearer auth, json_schema strict, and the configured model", async () => {
    const { adapter, calls } = make((url) => (url.endsWith("/models") ? models() : completion()));
    const out = await adapter.completeJson(req);
    const chat = calls.find((c) => c.url.endsWith("/chat/completions"))!;
    expect(chat.url).toBe("https://api.aiand.com/v1/chat/completions");
    expect(new Headers(chat.init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    const body = bodyOf(chat);
    expect(body.model).toBe("test/model");
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "t", strict: true, schema: { type: "object" } },
    });
    expect(body.reasoning_effort).toBe("low");
    expect(body.messages[1].content).toBe("usr");
    expect(out).toMatchObject({
      content: '{"ok":true}',
      responseMode: "json_schema",
      imageSent: false,
    });
    expect(out.usage).toEqual({
      promptTokens: 7,
      completionTokens: 3,
      totalTokens: 10,
      reasoningTokens: 1,
    });
  });

  it("prefers reasoning_effort none when the model offers it and omits it when unknown", async () => {
    const a = make((url) =>
      url.endsWith("/models") ? models(["vision"], ["none", "high"]) : completion(),
    );
    await a.adapter.completeJson(req);
    expect(bodyOf(a.calls.find((c) => c.url.endsWith("/chat/completions"))!).reasoning_effort).toBe(
      "none",
    );
    const b = make((url) => (url.endsWith("/models") ? json({}, 500) : completion()));
    await b.adapter.completeJson(req);
    expect(bodyOf(b.calls.find((c) => c.url.endsWith("/chat/completions"))!)).not.toHaveProperty(
      "reasoning_effort",
    );
  });

  it("retries once with json_object (schema in the prompt) when json_schema is rejected", async () => {
    let attempt = 0;
    const { adapter, calls } = make((url) => {
      if (url.endsWith("/models")) return models();
      return ++attempt === 1 ? json({ error: { message: "unsupported" } }, 400) : completion();
    });
    const out = await adapter.completeJson(req);
    const chats = calls.filter((c) => c.url.endsWith("/chat/completions"));
    expect(chats).toHaveLength(2);
    expect(bodyOf(chats[1]!).response_format).toEqual({ type: "json_object" });
    expect(bodyOf(chats[1]!).messages[0].content).toContain('"type":"object"');
    expect(out.responseMode).toBe("json_object");
  });

  it("uses a custom base URL", async () => {
    const calls: string[] = [];
    const adapter = new AiandAdapter({
      apiKey: KEY,
      modelId: "m",
      baseUrl: "https://example.test/v1/",
      fetchImpl: (async (u: string) => {
        calls.push(String(u));
        return String(u).endsWith("/models") ? models() : completion();
      }) as unknown as typeof fetch,
    });
    await adapter.completeJson(req);
    expect(calls).toContain("https://example.test/v1/chat/completions");
  });
});

describe("AiandAdapter images", () => {
  it("uploads via the Files API, references file_id, then deletes the file", async () => {
    const { adapter, calls } = make((url, init) => {
      if (url.endsWith("/models")) return models();
      if (url.endsWith("/files") && init.method === "POST") return json({ id: "file-abc" });
      if (url.endsWith("/files/file-abc")) return json({ deleted: true });
      return completion();
    });
    const out = await adapter.completeJson({ ...req, image });
    const chat = bodyOf(calls.find((c) => c.url.endsWith("/chat/completions"))!);
    expect(chat.messages[1].content).toEqual([
      { type: "text", text: "usr" },
      { type: "file", file: { file_id: "file-abc" } },
    ]);
    expect(JSON.stringify(chat)).not.toContain("base64");
    const upload = calls.find((c) => c.url.endsWith("/files") && c.init.method === "POST")!;
    expect((upload.init.body as FormData).get("purpose")).toBe("vision");
    expect(calls.at(-1)).toMatchObject({
      url: "https://api.aiand.com/v1/files/file-abc",
      init: expect.objectContaining({ method: "DELETE" }),
    });
    expect(out.imageSent).toBe(true);
  });

  it("deletes the file even when the completion fails", async () => {
    const { adapter, calls } = make((url, init) => {
      if (url.endsWith("/models")) return models();
      if (url.endsWith("/files") && init.method === "POST") return json({ id: "file-abc" });
      if (url.endsWith("/chat/completions")) return json({}, 500);
      return json({ deleted: true });
    });
    await expect(adapter.completeJson({ ...req, image })).rejects.toMatchObject({
      code: "provider_error",
    });
    expect(calls.some((c) => c.init.method === "DELETE" && c.url.endsWith("/files/file-abc"))).toBe(
      true,
    );
  });

  it("sends the image inline (not stored) when the org is on zero data retention", async () => {
    const { adapter, calls } = make((url, init) => {
      if (url.endsWith("/models")) return models();
      if (url.endsWith("/files") && init.method === "POST")
        return json({ error: { code: "zero_data_retention" } }, 403);
      return completion();
    });
    const out = await adapter.completeJson({ ...req, image });
    const chat = bodyOf(calls.find((c) => c.url.endsWith("/chat/completions"))!);
    expect(chat.messages[1].content[1].type).toBe("image_url");
    expect(chat.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(calls.some((c) => c.init.method === "DELETE")).toBe(false);
    expect(out.imageSent).toBe(true);
  });

  it("refuses to send an image to a model without vision, or a HEIC image", async () => {
    const noVision = make((url) =>
      url.endsWith("/models") ? models(["reasoning"]) : completion(),
    );
    await expect(noVision.adapter.completeJson({ ...req, image })).rejects.toBeInstanceOf(LlmError);
    expect(noVision.calls.some((c) => c.url.endsWith("/files"))).toBe(false);
    const heic = make((url) => (url.endsWith("/models") ? models() : completion()));
    await expect(
      heic.adapter.completeJson({ ...req, image: { ...image, mimeType: "image/heic" } }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it("reports vision support from the model catalog", async () => {
    expect(await make(() => models(["vision"])).adapter.supportsVision()).toBe(true);
    expect(await make(() => models(["reasoning"])).adapter.supportsVision()).toBe(false);
    expect(await make(() => json({}, 500)).adapter.supportsVision()).toBe(false);
    expect(make(() => models()).adapter.supportsImageType("image/heic")).toBe(false);
    expect(make(() => models()).adapter.supportsImageType("image/png")).toBe(true);
  });
});

describe("AiandAdapter errors", () => {
  const status = (code: number) =>
    make((url) =>
      url.endsWith("/models") ? models() : json({ error: { message: `leak ${KEY}` } }, code),
    );
  it.each([
    [429, "rate_limited"],
    [402, "insufficient_credits"],
    [504, "timeout"],
    [500, "provider_error"],
    [401, "provider_error"],
  ])("maps HTTP %i to %s", async (code, expected) => {
    await expect(status(code).adapter.completeJson(req)).rejects.toMatchObject({ code: expected });
  });

  it("rejects invalid, empty, and truncated responses", async () => {
    for (const body of [
      completion(""),
      json({ nope: 1 }),
      json({ choices: [{ finish_reason: "length", message: { content: "{" } }] }),
    ]) {
      const { adapter } = make((url) => (url.endsWith("/models") ? models() : body.clone()));
      await expect(adapter.completeJson(req)).rejects.toMatchObject({ code: "invalid_response" });
    }
    const notJson = make((url) => (url.endsWith("/models") ? models() : new Response("<html>")));
    await expect(notJson.adapter.completeJson(req)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("maps network failures and timeouts, and never leaks the key or response body", async () => {
    const down = make((url) => {
      if (url.endsWith("/models")) return models();
      throw new Error(`connect failed ${KEY}`);
    });
    const err = await down.adapter.completeJson(req).catch((e) => e);
    expect(err.code).toBe("provider_error");
    expect(err.message).not.toContain(KEY);
    const leaky = await status(500)
      .adapter.completeJson(req)
      .catch((e) => e);
    expect(leaky.message).not.toContain(KEY);
    const slow = make(
      (url, init) =>
        url.endsWith("/models")
          ? models()
          : new Promise<Response>((_r, reject) =>
              init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
            ),
      { timeoutMs: 20 },
    );
    await expect(slow.adapter.completeJson(req)).rejects.toMatchObject({ code: "timeout" });
  });
});

describe("getLlmAdapter", () => {
  it("needs a key and a real model ID, read from configuration", () => {
    const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
    expect(getLlmAdapter(env({}))).toBeNull();
    expect(getLlmAdapter(env({ AIAND_API_KEY: "k" }))).toBeNull();
    expect(
      getLlmAdapter(env({ AIAND_API_KEY: "k", AIAND_MODEL: "choose-a-vision-capable-model" })),
    ).toBeNull();
    const a = getLlmAdapter(env({ AIAND_API_KEY: "k", AIAND_MODEL: "vendor/some-model" }));
    expect(a?.modelId).toBe("vendor/some-model");
    expect(a?.provider).toBe("aiand");
  });
});
