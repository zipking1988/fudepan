import { describe, expect, it } from "vitest";
import {
  UploadValidationError,
  checkFileClientSide,
  detectImageType,
  validateImageBytes,
} from "@/lib/uploads/validate";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const heic = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from("ftypheic")]);

describe("detectImageType", () => {
  it("detects JPEG, PNG and HEIC from bytes", () => {
    expect(detectImageType(jpeg)).toBe("image/jpeg");
    expect(detectImageType(png)).toBe("image/png");
    expect(detectImageType(heic)).toBe("image/heic");
  });
  it("rejects other content such as PDF, GIF or text", () => {
    expect(detectImageType(new Uint8Array(Buffer.from("%PDF-1.7 ....")))).toBeNull();
    expect(detectImageType(new Uint8Array(Buffer.from("GIF89a......")))).toBeNull();
    expect(detectImageType(new Uint8Array(Buffer.from("hello")))).toBeNull();
  });
});

describe("validateImageBytes", () => {
  it("accepts valid images and reports the detected type", () => {
    expect(validateImageBytes(jpeg).mimeType).toBe("image/jpeg");
  });
  it("rejects empty files", () => {
    expect(() => validateImageBytes(new Uint8Array())).toThrowError(UploadValidationError);
  });
  it("rejects files over 10 MB", () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(jpeg);
    try {
      validateImageBytes(big);
      expect.unreachable();
    } catch (e) {
      expect((e as UploadValidationError).code).toBe("too_large");
    }
  });
  it("rejects a renamed non-image with a plain-language message", () => {
    try {
      validateImageBytes(new Uint8Array(Buffer.from("not an image at all")));
      expect.unreachable();
    } catch (e) {
      expect((e as UploadValidationError).code).toBe("unsupported_type");
      expect((e as Error).message).toMatch(/JPG, PNG, or HEIC/);
    }
  });
});

describe("checkFileClientSide", () => {
  it("accepts HEIC by extension when the browser gives no type", () => {
    expect(checkFileClientSide({ size: 10, name: "note.HEIC", type: "" })).toBeNull();
  });
  it("flags empty, large and unsupported files", () => {
    expect(checkFileClientSide({ size: 0, name: "a.jpg", type: "image/jpeg" })).toMatch(/empty/);
    expect(checkFileClientSide({ size: 11e6, name: "a.jpg", type: "image/jpeg" })).toMatch(
      /too big/,
    );
    expect(checkFileClientSide({ size: 10, name: "a.pdf", type: "application/pdf" })).toMatch(
      /JPG/,
    );
  });
});
