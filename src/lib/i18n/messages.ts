/**
 * Translator over the typed dictionaries (family-shared-care design, K9). No framework.
 * `ja` has every key (checked by typecheck). The English fallback in `lookup` is a safety net only.
 */
import { en, type MessageKey, type Messages } from "./en";
import { pluralCategory, type Language } from "./format";
import { ja } from "./ja";

export type { Language, MessageKey, Messages };

export type MessageParams = Readonly<Record<string, string | number>>;

export type Dictionaries = Readonly<Record<Language, Readonly<Partial<Messages>>>>;

export const DICTIONARIES: Dictionaries = { en, ja };

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];

export function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

/**
 * Replaces `{param}` in one pass. A value is never scanned again, so a name that contains
 * braces cannot inject another placeholder. A placeholder with no value stays as written.
 */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole,
  );
}

export type Translator = {
  readonly lang: Language;
  t: (key: MessageKey, params?: MessageParams) => string;
  /** Picks `${baseKey}.one` or `${baseKey}.other`, and fills `{count}`. */
  tCount: (baseKey: PluralBaseKey, count: number, params?: MessageParams) => string;
};

/** Keys that have both a `.one` and an `.other` form. */
export type PluralBaseKey = { [K in MessageKey]: K extends `${infer B}.one` ? B : never }[MessageKey];

/** Looks a key up in one language, then in English. */
export function lookup(lang: Language, key: MessageKey, dictionaries: Dictionaries = DICTIONARIES): string {
  const own = dictionaries[lang][key];
  if (typeof own === "string" && own.length > 0) return own;
  return dictionaries.en[key] ?? key;
}

export function t(lang: Language, key: MessageKey, params?: MessageParams): string {
  return interpolate(lookup(lang, key), params);
}

export function createTranslator(lang: Language, dictionaries: Dictionaries = DICTIONARIES): Translator {
  const translate = (key: MessageKey, params?: MessageParams) =>
    interpolate(lookup(lang, key, dictionaries), params);
  return {
    lang,
    t: translate,
    tCount: (baseKey, count, params) =>
      translate(`${baseKey}.${pluralCategory(count, lang)}` as MessageKey, { ...params, count }),
  };
}

/** Dev and test check: the keys that are not in the English dictionary. Empty means all exist. */
export function findUnknownKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => !isMessageKey(key));
}

/** Throws with the list of unknown keys. Use in tests and development; never on a request path. */
export function assertKeysExist(keys: readonly string[]): void {
  const unknown = findUnknownKeys(keys);
  if (unknown.length > 0) throw new Error(`Unknown message keys: ${unknown.join(", ")}`);
}

/** Keys the other language has not translated. Empty for `ja`. */
export function findUntranslatedKeys(lang: Language, dictionaries: Dictionaries = DICTIONARIES): MessageKey[] {
  if (lang === "en") return [];
  return MESSAGE_KEYS.filter((key) => {
    const value = dictionaries[lang][key];
    return typeof value !== "string" || value.length === 0;
  });
}
