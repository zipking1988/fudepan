import { afterEach, describe, expect, it, vi } from "vitest";

import { errorCode, log, maskLogFields } from "./log";

afterEach(() => vi.restoreAllMocks());

describe("maskLogFields", () => {
  it("keeps IDs, codes, numbers, and booleans", () => {
    expect(
      maskLogFields({
        user_id: "d1000000-0000-4000-8000-000000000002",
        stage: "verify",
        reason: "content_mismatch",
        count: 3,
        status: true,
      }),
    ).toEqual({
      user_id: "d1000000-0000-4000-8000-000000000002",
      stage: "verify",
      reason: "content_mismatch",
      count: 3,
      status: true,
    });
  });

  it("drops fields that are not on the allow-list", () => {
    expect(
      maskLogFields({
        file_name: "mom-insulin.jpg",
        email: "misa.demo@example.com",
        note_id: "n1",
      }),
    ).toEqual({ note_id: "n1" });
  });

  it("redacts values that could hold names, paths, URLs, or note text", () => {
    const masked = maskLogFields({
      household_id: "d0000000-0000-4000-8000-000000000001/d3000000/1763700000000-note.jpg",
      reason: "Pick up blood-pressure medicine",
      code: "https://127.0.0.1:54321/storage/v1/object/sign/notes/x?token=abc",
      stage: { nested: "object" },
    });
    expect(masked).toEqual({
      household_id: "[REDACTED]",
      reason: "[REDACTED]",
      code: "[REDACTED]",
      stage: "[REDACTED]",
    });
  });
});

describe("log", () => {
  it("writes one JSON line with only masked fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log("warn", "note_upload.failed", { note_id: "n1", reason: "Mom's insulin" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toEqual({
      level: "warn",
      event: "note_upload.failed",
      note_id: "n1",
      reason: "[REDACTED]",
    });
  });

  it("refuses free-form event names", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    log("info", "Uploaded mom-insulin.jpg", {});
    expect(JSON.parse(String(info.mock.calls[0][0])).event).toBe("invalid_event_name");
  });
});

describe("errorCode", () => {
  it("returns a code, never the message", () => {
    expect(errorCode({ code: "PGRST116", message: "path d0000000/x leaked" })).toBe("PGRST116");
    expect(errorCode({ status: 413, message: "Payload too large" })).toBe("413");
    expect(errorCode(new Error("secret path"))).toBe("Error");
    expect(errorCode("text")).toBe("unknown");
  });
});
