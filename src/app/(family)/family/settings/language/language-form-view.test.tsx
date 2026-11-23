import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import { resolveLanguage } from "@/lib/i18n/language";
import { LanguageFormView, type LanguageStatus } from "./language-form-view";

function render(lang: Language, selected: Language, status: LanguageStatus = null, pending = false) {
  return renderToStaticMarkup(
    <LanguageFormView tr={createTranslator(lang)} selected={selected} status={status} pending={pending} />,
  );
}

describe("language form markup", () => {
  it.each([
    ["en", "App language", "Save"],
    ["ja", "アプリの言語", "保存する"],
  ] as const)("shows a labelled radio group in %s with each option in its own language", (lang, legend, save) => {
    const html = render(lang, lang);
    expect(html).toContain(`<legend class="app-label mb-2">${legend}</legend>`);
    expect(html).toContain("<fieldset");
    expect(html).toMatch(/<label for="language-en" lang="en"[^>]*>.*?<span>English<\/span>/);
    expect(html).toMatch(/<label for="language-ja" lang="ja"[^>]*>.*?<span>日本語<\/span>/);
    expect(html.match(/<input[^>]*type="radio"[^>]*name="language"/g)).toHaveLength(2);
    expect(html).toContain(`>${save}</button>`);
  });

  it("preselects the current language", () => {
    const en = render("en", "en");
    expect(en).toMatch(/id="language-en"[^>]*checked/);
    expect(en).not.toMatch(/id="language-ja"[^>]*checked/);
    const ja = render("ja", "ja");
    expect(ja).toMatch(/id="language-ja"[^>]*checked/);
    expect(ja).not.toMatch(/id="language-en"[^>]*checked/);
  });

  it("announces the result politely and shows a plain error as an alert", () => {
    const saved = render("ja", "ja", { kind: "saved", text: "保存しました" });
    expect(saved).toMatch(/role="status" aria-live="polite"><p[^>]*>保存しました<\/p>/);
    const failed = render("en", "en", { kind: "error", text: "Something went wrong." });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Your language was not saved");
    expect(failed).toContain("Something went wrong.");
    expect(render("en", "en")).toContain('role="status" aria-live="polite"></div>');
  });

  it("disables the button while saving", () => {
    expect(render("en", "en", null, true)).toMatch(/<button type="submit" class="app-button" disabled="">Saving…/);
  });

  it("uses the saved language on the next render", () => {
    expect(resolveLanguage("ja", "en-US")).toBe("ja");
    expect(createTranslator(resolveLanguage("ja", "en-US")).t("language.saved")).toBe("保存しました");
  });
});
