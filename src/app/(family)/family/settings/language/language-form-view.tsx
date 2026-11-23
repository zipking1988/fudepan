import type { ChangeEvent, FormEvent } from "react";
import type { Language, Translator } from "@/lib/i18n/messages";

/** Each option is written in its own language, so it can be found whatever the current language is. */
export const LANGUAGE_OPTIONS: readonly { value: Language; label: string; lang: string }[] = [
  { value: "en", label: "English", lang: "en" },
  { value: "ja", label: "日本語", lang: "ja" },
];

export type LanguageStatus = { kind: "saved"; text: string } | { kind: "error"; text: string } | null;

/** Presentational language form. All behavior lives in LanguageForm. */
export function LanguageFormView({
  tr,
  selected,
  pending = false,
  status = null,
  onChange,
  onSubmit,
}: {
  tr: Translator;
  selected: Language;
  pending?: boolean;
  status?: LanguageStatus;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section aria-labelledby="language-heading" className="app-panel">
      <h1 id="language-heading" className="app-subtitle">
        {tr.t("language.title")}
      </h1>
      <p id="language-lede" className="app-hint mt-3">
        {tr.t("language.lede")}
      </p>
      <form onSubmit={onSubmit} aria-busy={pending} className="mt-5 grid gap-5">
        <fieldset className="grid gap-3 border-0 p-0" aria-describedby="language-lede">
          <legend className="app-label mb-2">{tr.t("language.legend")}</legend>
          {LANGUAGE_OPTIONS.map((option) => (
            <label
              key={option.value}
              htmlFor={`language-${option.value}`}
              lang={option.lang}
              className="flex min-h-12 cursor-pointer items-center gap-3 rounded border-2 border-current px-4 py-2 text-lg"
            >
              <input
                id={`language-${option.value}`}
                type="radio"
                name="language"
                value={option.value}
                checked={selected === option.value}
                onChange={onChange}
                className="size-6 shrink-0"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </fieldset>
        <div>
          <button type="submit" className="app-button" disabled={pending}>
            {pending ? tr.t("language.saving") : tr.t("language.save")}
          </button>
        </div>
        <div role="status" aria-live="polite">
          {status?.kind === "saved" && <p className="app-success font-semibold">{status.text}</p>}
        </div>
        {status?.kind === "error" && (
          <div role="alert" className="app-alert">
            <p className="app-alert__title">{tr.t("language.errorTitle")}</p>
            <p>{status.text}</p>
          </div>
        )}
      </form>
    </section>
  );
}
