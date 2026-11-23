import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock getServerEnv to control return values per test
vi.mock("@/lib/env/server", () => ({
  getServerEnv: vi.fn(),
}));

import { COMPLETION_TIMEOUT_MS, extractCareChain } from "./client";
import { getServerEnv } from "@/lib/env/server";

/**
 * Unit tests for the ai& client.
 *
 * These tests verify:
 * 1. Correct request format per ai& docs (file content type, not image_file)
 * 2. Error handling for various failure modes
 * 3. No sensitive data in logs
 */

describe("extractCareChain", () => {
  const mockImageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const mockContentType = "image/jpeg";

  const baseEnv = {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    APP_BASE_URL: "http://localhost:3000",
  };

  beforeEach(() => {
    global.fetch = vi.fn();

    // Default: all env vars available
    vi.mocked(getServerEnv).mockReturnValue({
      ...baseEnv,
      AIAND_API_KEY: "sk-test-key",
      AIAND_BASE_URL: "https://api.aiand.com/v1",
      AIAND_MODEL: "test-model",
    });
  });

  it("uses correct file content type per ai& documentation", async () => {
    const mockFileId = "file-abc123";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      // Files API upload
      if (url.includes("/files") && !url.includes("/files/file-")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: mockFileId }),
        });
      }

      // Chat completions
      if (url.includes("/chat/completions")) {
        const validDraft = {
          chain_title: "Test",
          overall_risk: "low",
          steps: [
            {
              title: "Test step",
              description: "Test",
              care_category: "household",
              risk_level: "low",
              suggested_owner_role: "family_member",
              due_at: null,
              escalation_at: null,
              evidence_required: [],
              approval_required: false,
              source_quote: "test",
              confidence: 0.9,
            },
          ],
          ambiguities: [],
          ai_boundary: {
            medical_advice_requested: false,
            blocked_actions: [],
            explanation: "",
          },
        };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(validDraft) } }],
          }),
        });
      }

      // File deletion
      if (url.includes("/files/file-")) {
        return Promise.resolve({ ok: true });
      }

      return Promise.resolve({ ok: false });
    });

    await extractCareChain(mockImageBytes, mockContentType);

    // Verify the chat completions request uses the correct format
    const completionsCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      call[0].includes("/chat/completions"),
    );

    expect(completionsCall).toBeDefined();

    const requestBody = JSON.parse(completionsCall![1].body);
    const userMessage = requestBody.messages.find((m: { role: string }) => m.role === "user");

    expect(userMessage).toBeDefined();
    expect(userMessage.content).toBeInstanceOf(Array);

    const fileContent = userMessage.content.find((c: { type: string }) => c.type === "file");
    expect(fileContent).toBeDefined();
    expect(fileContent.type).toBe("file");
    expect(fileContent.file).toEqual({ file_id: mockFileId });

    // Should NOT use image_file format
    const wrongFormat = userMessage.content.find((c: { type: string }) => c.type === "image_file");
    expect(wrongFormat).toBeUndefined();
  });

  it("returns upload_failed when Files API fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    });

    const result = await extractCareChain(mockImageBytes, mockContentType);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("upload_failed");
    }
  });

  it("returns completion_failed when Chat Completions API fails", async () => {
    const mockFileId = "file-abc123";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/files") && !url.includes("/files/file-")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: mockFileId }),
        });
      }

      if (url.includes("/chat/completions")) {
        return Promise.resolve({
          ok: false,
          status: 400,
        });
      }

      return Promise.resolve({ ok: true });
    });

    const result = await extractCareChain(mockImageBytes, mockContentType);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("completion_failed");
    }
  });

  it("returns invalid_json when response is not valid JSON", async () => {
    const mockFileId = "file-abc123";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/files") && !url.includes("/files/file-")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: mockFileId }),
        });
      }

      if (url.includes("/chat/completions")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "not valid json{" } }],
          }),
        });
      }

      return Promise.resolve({ ok: true });
    });

    const result = await extractCareChain(mockImageBytes, mockContentType);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_json");
    }
  });

  it("returns schema_invalid when response does not match schema", async () => {
    const mockFileId = "file-abc123";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/files") && !url.includes("/files/file-")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: mockFileId }),
        });
      }

      if (url.includes("/chat/completions")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    chain_title: "Test",
                    // Missing required fields
                  }),
                },
              },
            ],
          }),
        });
      }

      return Promise.resolve({ ok: true });
    });

    const result = await extractCareChain(mockImageBytes, mockContentType);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("schema_invalid");
    }
  });

  it("returns safety_violation when draft violates safety rules", async () => {
    const mockFileId = "file-abc123";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/files") && !url.includes("/files/file-")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: mockFileId }),
        });
      }

      if (url.includes("/chat/completions")) {
        // Draft with high-risk step but no approval required (safety violation)
        const unsafeDraft = {
          chain_title: "Medication pickup",
          overall_risk: "high",
          steps: [
            {
              title: "Pick up medication",
              description: "Get prescription from pharmacy",
              care_category: "medication",
              risk_level: "high",
              suggested_owner_role: "family_member",
              due_at: null,
              escalation_at: null,
              evidence_required: [],
              approval_required: false, // Safety violation!
              source_quote: "get meds",
              confidence: 0.8,
            },
          ],
          ambiguities: [],
          ai_boundary: {
            medical_advice_requested: false,
            blocked_actions: [],
            explanation: "",
          },
        };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(unsafeDraft) } }],
          }),
        });
      }

      return Promise.resolve({ ok: true });
    });

    const result = await extractCareChain(mockImageBytes, mockContentType);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("safety_violation");
    }
  });

  it("returns model_unavailable when environment is not configured", async () => {
    // Mock getServerEnv to return env without AIAND vars
    vi.mocked(getServerEnv).mockReturnValue({
      ...baseEnv,
      AIAND_API_KEY: undefined,
      AIAND_BASE_URL: undefined,
      AIAND_MODEL: undefined,
    });

    const result = await extractCareChain(mockImageBytes, mockContentType);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("model_unavailable");
      expect(result.detail).toContain("AI extraction is not configured");
    }
  });

  it("includes response_format json_object in the request", async () => {
    const mockFileId = "file-abc123";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/files") && !url.includes("/files/file-")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: mockFileId }),
        });
      }

      if (url.includes("/chat/completions")) {
        const validDraft = {
          chain_title: "Test",
          overall_risk: "low",
          steps: [
            {
              title: "Test",
              description: "Test",
              care_category: "household",
              risk_level: "low",
              suggested_owner_role: "family_member",
              due_at: null,
              escalation_at: null,
              evidence_required: [],
              approval_required: false,
              source_quote: "test",
              confidence: 0.9,
            },
          ],
          ambiguities: [],
          ai_boundary: {
            medical_advice_requested: false,
            blocked_actions: [],
            explanation: "",
          },
        };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(validDraft) } }],
          }),
        });
      }

      return Promise.resolve({ ok: true });
    });

    await extractCareChain(mockImageBytes, mockContentType);

    const completionsCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
      call[0].includes("/chat/completions"),
    );

    expect(completionsCall).toBeDefined();

    const requestBody = JSON.parse(completionsCall![1].body);
    expect(requestBody.response_format).toEqual({ type: "json_object" });
  });

  it("normalizes unsupported deadline to null but keeps draft valid", async () => {
    // Regression test: AI returns invented 9:00 AM for date-only note
    const mockFileId = "file-abc123";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/files") && !url.includes("/files/file-")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: mockFileId }),
        });
      }

      if (url.includes("/chat/completions")) {
        // AI draft with invented time
        const draftWithInventedTime = {
          chain_title: "Clinic visit preparation",
          overall_risk: "high",
          steps: [
            {
              title: "Clinic visit",
              description: "Bring insurance card",
              care_category: "appointment",
              risk_level: "high",
              suggested_owner_role: "family_member",
              due_at: "2026-11-20T09:00:00Z", // AI invented 9:00 AM
              escalation_at: null,
              evidence_required: ["insurance card"],
              approval_required: true,
              source_quote: "Friday, November 20, 2026. Bring the insurance card to the clinic visit.",
              confidence: 0.85,
            },
          ],
          ambiguities: [],
          ai_boundary: {
            medical_advice_requested: false,
            blocked_actions: [],
            explanation: "",
          },
        };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(draftWithInventedTime) } }],
          }),
        });
      }

      return Promise.resolve({ ok: true });
    });

    const result = await extractCareChain(mockImageBytes, mockContentType);

    // Should succeed, not reject
    expect(result.ok).toBe(true);

    if (result.ok) {
      // Unsupported deadline should be cleared
      expect(result.draft.steps[0].due_at).toBeNull();

      // High-risk approval should be preserved
      expect(result.draft.steps[0].approval_required).toBe(true);

      // Ambiguity should be added
      expect(result.draft.ambiguities.length).toBeGreaterThan(0);
      const timeAmbiguity = result.draft.ambiguities.find((a) => a.field.includes("due_at"));
      expect(timeAmbiguity).toBeDefined();
    }
  });

  it("preserves supported deadline with explicit time in quote", async () => {
    const mockFileId = "file-abc123";

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/files") && !url.includes("/files/file-")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: mockFileId }),
        });
      }

      if (url.includes("/chat/completions")) {
        // Draft with valid explicit times
        const draftWithExplicitTime = {
          chain_title: "Family confirmation needed",
          overall_risk: "medium",
          steps: [
            {
              title: "Check with family",
              description: "Confirm appointment",
              care_category: "communication",
              risk_level: "medium",
              suggested_owner_role: "family_member",
              due_at: "2026-11-20T17:00:00+09:00", // 5:00 PM JST
              escalation_at: "2026-11-20T18:00:00+09:00", // 6:00 PM JST
              evidence_required: [],
              approval_required: false,
              source_quote: "Check by 5:00 PM JST. If unanswered by 6:00 PM JST, ask the backup person.",
              confidence: 0.92,
            },
          ],
          ambiguities: [],
          ai_boundary: {
            medical_advice_requested: false,
            blocked_actions: [],
            explanation: "",
          },
        };

        return Promise.resolve({
          ok: true,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(draftWithExplicitTime) } }],
          }),
        });
      }

      return Promise.resolve({ ok: true });
    });

    const result = await extractCareChain(mockImageBytes, mockContentType);

    expect(result.ok).toBe(true);

    if (result.ok) {
      // Supported deadlines should be preserved
      expect(result.draft.steps[0].due_at).toBe("2026-11-20T17:00:00+09:00");
      expect(result.draft.steps[0].escalation_at).toBe("2026-11-20T18:00:00+09:00");

      // No time-related ambiguities should be added
      const timeAmbiguities = result.draft.ambiguities.filter(
        (a) => a.field.includes("due_at") || a.field.includes("escalation_at"),
      );
      expect(timeAmbiguities).toEqual([]);
    }
  });
});

describe("extractCareChain with person_to_ask", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  function mockAi(draft: unknown) {
    vi.mocked(getServerEnv).mockReturnValue({
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      APP_BASE_URL: "http://localhost:3000",
      AIAND_API_KEY: "sk-test-key",
      AIAND_BASE_URL: "https://api.aiand.com/v1",
      AIAND_MODEL: "test-model",
    });
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chat/completions")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ choices: [{ message: { content: JSON.stringify(draft) } }] }),
        });
      }
      if (url.endsWith("/files")) {
        return Promise.resolve({ ok: true, json: async () => ({ id: "file-1" }) });
      }
      return Promise.resolve({ ok: true });
    });
  }

  const draft = (stepExtra: Record<string, unknown>) => ({
    chain_title: "Clinic visit",
    overall_risk: "high",
    steps: [
      {
        title: "Find out which clinic",
        description: "",
        care_category: "appointment",
        risk_level: "high",
        suggested_owner_role: "a family member who drives",
        due_at: "2026-11-20T15:00:00+09:00",
        escalation_at: null,
        evidence_required: [],
        approval_required: true,
        source_quote: "Ask Misa which clinic, 3:00 PM",
        confidence: 0.8,
        ...stepExtra,
      },
    ],
    ambiguities: [{ field: "location", question: "Which clinic?", reason: "Not written", step_index: 0, kind: "location" }],
    ai_boundary: { medical_advice_requested: false, blocked_actions: [], explanation: "" },
  });

  it("keeps person_to_ask 'Misa', sets no owner, and nulls the appointment deadline", async () => {
    mockAi(draft({ person_to_ask: "Misa", owner_id: "someone" }));
    const result = await extractCareChain(bytes, "image/jpeg");
    expect(result.ok).toBe(true);
    if (result.ok) {
      const step = result.draft.steps[0] as Record<string, unknown>;
      expect(step.person_to_ask).toBe("Misa");
      expect(step.owner_id).toBeUndefined();
      expect(step.due_at).toBeNull();
      expect(result.draft.ambiguities[0]).toMatchObject({ step_index: 0, kind: "location" });
    }
  });

  it("returns schema_invalid for an unsafe ambiguity kind", async () => {
    const d = draft({});
    d.ambiguities[0].kind = "diagnosis";
    mockAi(d);
    const result = await extractCareChain(bytes, "image/jpeg");
    expect(result).toMatchObject({ ok: false, reason: "schema_invalid" });
  });

  it("returns safety_violation when a high-risk step skips approval", async () => {
    mockAi(draft({ person_to_ask: "Misa", approval_required: false }));
    const result = await extractCareChain(bytes, "image/jpeg");
    expect(result).toMatchObject({ ok: false, reason: "safety_violation" });
  });

  it("tells the model not to assign people or guess details", async () => {
    mockAi(draft({ person_to_ask: "Misa" }));
    await extractCareChain(bytes, "image/jpeg");
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("/chat/completions"),
    );
    const system = JSON.parse(call![1].body).messages[0].content as string;
    expect(system).toContain("Never assign a person");
    expect(system).toContain("Ask Misa which clinic");
    expect(system).toContain("person_to_ask");
    expect(system).toContain("qualified professional");
  });
});

describe("extractCareChain time limits", () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  beforeEach(() => {
    vi.mocked(getServerEnv).mockReturnValue({
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      APP_BASE_URL: "http://localhost:3000",
      AIAND_API_KEY: "sk-test-key",
      AIAND_BASE_URL: "https://api.aiand.com/v1",
      AIAND_MODEL: "test-model",
    });
  });

  /** A fetch that never answers and only ends when its signal aborts. */
  function hangingFetch(init: RequestInit | undefined): Promise<Response> {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    });
  }

  it("keeps the completion limit below the 300 second route budget", () => {
    expect(COMPLETION_TIMEOUT_MS).toBe(240_000);
    expect(COMPLETION_TIMEOUT_MS).toBeLessThan(300_000);
  });

  it("maps a chat completion that never answers to completion_failed", async () => {
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/chat/completions")) return hangingFetch(init);
      if (url.includes("/files/file-")) return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true, json: async () => ({ id: "file-1" }) });
    });
    const result = await extractCareChain(bytes, "image/jpeg", { completionTimeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, reason: "completion_failed" });
  });

  it("maps a Files API upload that never answers to upload_failed", async () => {
    global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => hangingFetch(init));
    const result = await extractCareChain(bytes, "image/jpeg", { uploadTimeoutMs: 20 });
    expect(result).toMatchObject({ ok: false, reason: "upload_failed" });
  });
});
