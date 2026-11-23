import { describe, expect, it } from "vitest";

import { isLanguage, LANGUAGES, resolveLanguage } from "./language";

describe("resolveLanguage", () => {
  it("lets the saved member setting win over the header", () => {
    expect(resolveLanguage("en", "ja-JP,ja;q=0.9")).toBe("en");
    expect(resolveLanguage("ja", "en-US,en;q=0.9")).toBe("ja");
  });

  it("uses Accept-Language when there is no saved setting", () => {
    expect(resolveLanguage(null, "ja-JP,ja;q=0.9,en;q=0.8")).toBe("ja");
    expect(resolveLanguage(undefined, "ja")).toBe("ja");
    expect(resolveLanguage(null, "en-US,en;q=0.9,ja;q=0.5")).toBe("en");
    expect(resolveLanguage(null, "fr-FR")).toBe("en");
    expect(resolveLanguage(null, "en;q=0.5, ja;q=0.9")).toBe("ja");
  });

  it("ignores unknown saved values and tags that only start with ja", () => {
    expect(resolveLanguage("fr", "ja")).toBe("ja");
    expect(resolveLanguage("", null)).toBe("en");
    expect(resolveLanguage(null, "jam")).toBe("en");
  });

  it("defaults to English", () => {
    expect(resolveLanguage(null)).toBe("en");
    expect(resolveLanguage(null, "")).toBe("en");
    expect(resolveLanguage(null, "*")).toBe("en");
  });

  it("exposes the supported languages", () => {
    expect([...LANGUAGES]).toEqual(["en", "ja"]);
    expect(isLanguage("ja")).toBe(true);
    expect(isLanguage("de")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});
