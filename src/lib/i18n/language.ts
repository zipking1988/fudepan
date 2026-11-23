/**
 * Language resolution (family-shared-care design, "i18n"). Pure: no I/O, no clock, no headers access.
 * The Member's saved setting wins. Without one, the browser's Accept-Language decides. Default English.
 */
import type { Language } from "./format";

export type { Language };

export const LANGUAGES: readonly Language[] = ["en", "ja"];

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** The most preferred language tag in an Accept-Language header, by q value then by position. */
function preferredTag(header: string): string | null {
  let best: { tag: string; q: number } | null = null;
  for (const part of header.split(",")) {
    const [rawTag = "", ...params] = part.trim().split(";");
    const tag = rawTag.trim().toLowerCase();
    if (!tag) continue;
    let q = 1;
    for (const param of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param);
      if (m) q = Number.parseFloat(m[1] ?? "");
    }
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!best || q > best.q) best = { tag, q };
  }
  return best?.tag ?? null;
}

export function resolveLanguage(
  memberUiLanguage: string | null | undefined,
  acceptLanguageHeader?: string | null,
): Language {
  if (isLanguage(memberUiLanguage)) return memberUiLanguage;
  if (!acceptLanguageHeader) return "en";
  const tag = preferredTag(acceptLanguageHeader);
  return tag === "ja" || tag?.startsWith("ja-") ? "ja" : "en";
}
