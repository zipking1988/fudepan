import { describe, expect, it } from "vitest";

import { MAX_NOTE_BYTES } from "./rules";
import {
  checkDeclaredNoteFile,
  checkNoteFile,
  formatFileSize,
  noteFileMessage,
  sniffNoteImageType,
} from "./validation";

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1,
]);
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n1 0");
const HEIC = new Uint8Array([
  0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0,
]);

describe("sniffNoteImageType", () => {
  it("recognises JPEG, PNG, and WebP from their first bytes", () => {
    expect(sniffNoteImageType(JPEG)).toBe("image/jpeg");
    expect(sniffNoteImageType(PNG)).toBe("image/png");
    expect(sniffNoteImageType(WEBP)).toBe("image/webp");
  });

  it("rejects other formats, RIFF files that are not WebP, and short input", () => {
    expect(sniffNoteImageType(PDF)).toBeNull();
    expect(sniffNoteImageType(HEIC)).toBeNull();
    const wav = WEBP.slice();
    wav.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(sniffNoteImageType(wav)).toBeNull();
    expect(sniffNoteImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffNoteImageType(new Uint8Array())).toBeNull();
  });
});

describe("checkNoteFile (browser)", () => {
  it("accepts a supported image and reports its real type", () => {
    expect(checkNoteFile({ type: "image/jpeg", size: 2_000_000 }, JPEG)).toEqual({
      ok: true,
      contentType: "image/jpeg",
    });
    // Browsers sometimes report no type, or a wrong one: the bytes decide.
    expect(checkNoteFile({ type: "", size: 10 }, PNG)).toEqual({
      ok: true,
      contentType: "image/png",
    });
    expect(checkNoteFile({ type: "image/jpeg", size: 10 }, WEBP)).toEqual({
      ok: true,
      contentType: "image/webp",
    });
  });

  it("allows exactly 10 MB and rejects one byte more", () => {
    expect(checkNoteFile({ type: "image/png", size: MAX_NOTE_BYTES }, PNG).ok).toBe(true);
    const tooBig = checkNoteFile({ type: "image/png", size: MAX_NOTE_BYTES + 1 }, PNG);
    expect(tooBig).toMatchObject({ ok: false, problem: "too_large" });
  });

  it("explains an oversized file with its size and what to do", () => {
    const result = checkNoteFile({ type: "image/jpeg", size: 12.4 * 1024 * 1024 }, JPEG);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe(
      "This photo is 12.4 MB. The limit is 10 MB. Crop the photo or take it again with a smaller size, then choose it here.",
    );
  });

  it("rejects an empty file", () => {
    expect(checkNoteFile({ type: "image/jpeg", size: 0 }, new Uint8Array())).toMatchObject({
      ok: false,
      problem: "empty",
      message: "This file is empty. Choose a photo of the note.",
    });
  });

  it("names the unsupported format and gives iPhone advice for HEIC", () => {
    const pdf = checkNoteFile({ type: "application/pdf", size: 5000 }, PDF);
    expect(pdf).toMatchObject({ ok: false, problem: "unsupported_type" });
    if (!pdf.ok) {
      expect(pdf.message).toBe(
        "Fudepan accepts photos saved as JPEG, PNG, or WebP. This file is a PDF document.",
      );
    }
    const heic = checkNoteFile({ type: "image/heic", size: 5000 }, HEIC);
    expect(heic).toMatchObject({ ok: false, problem: "unsupported_type" });
    if (!heic.ok) {
      expect(heic.message).toContain("This file is an iPhone HEIC photo.");
      expect(heic.message).toContain("choose Most Compatible");
    }
  });

  it("rejects a file that claims to be an image but is not", () => {
    expect(checkNoteFile({ type: "image/png", size: 5000 }, PDF)).toMatchObject({
      ok: false,
      problem: "not_an_image",
    });
    expect(checkNoteFile({ type: "", size: 5000 }, PDF)).toMatchObject({
      ok: false,
      problem: "not_an_image",
    });
  });

  it("never uses vague wording", () => {
    for (const problem of [
      "no_file",
      "empty",
      "too_large",
      "unsupported_type",
      "not_an_image",
    ] as const) {
      expect(noteFileMessage(problem, { type: "image/gif", size: 11 * 1024 * 1024 })).not.toMatch(
        /invalid input/i,
      );
    }
  });
});

describe("checkDeclaredNoteFile (server)", () => {
  it("checks the size and type the browser declares", () => {
    expect(checkDeclaredNoteFile({ type: "image/webp", size: 1 })).toEqual({
      ok: true,
      contentType: "image/webp",
    });
    expect(checkDeclaredNoteFile({ type: "image/webp", size: MAX_NOTE_BYTES }).ok).toBe(true);
    expect(checkDeclaredNoteFile({ type: "image/webp", size: MAX_NOTE_BYTES + 1 })).toMatchObject({
      problem: "too_large",
    });
    expect(checkDeclaredNoteFile({ type: "image/gif", size: 10 })).toMatchObject({
      problem: "unsupported_type",
    });
    expect(checkDeclaredNoteFile({ type: "image/svg+xml", size: 10 })).toMatchObject({
      problem: "unsupported_type",
    });
    expect(checkDeclaredNoteFile({ type: "image/png", size: 0 })).toMatchObject({
      problem: "empty",
    });
  });
});

describe("formatFileSize", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatFileSize(1)).toBe("1 byte");
    expect(formatFileSize(900)).toBe("900 bytes");
    expect(formatFileSize(640 * 1024)).toBe("640 KB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatFileSize(2.45 * 1024 * 1024)).toBe("2.5 MB");
  });
});
