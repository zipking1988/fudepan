"use client";

import { createTranslator } from "@/lib/i18n/messages";

/**
 * Plain message and retry. The error object is never shown: its text can hold private details.
 * An error boundary cannot read the member's language, so both languages are written out.
 */
export default function FamilyError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const ja = createTranslator("ja");
  const en = createTranslator("en");
  return (
    <div role="alert" className="grid gap-8">
      {[ja, en].map((tr) => (
        <section key={tr.lang} lang={tr.lang}>
          <h1 className="app-title">{tr.t("family.error.title")}</h1>
          <p className="app-lede">{tr.t("family.error.body")}</p>
          <button type="button" className="app-button" onClick={() => reset()}>
            {tr.t("family.error.retry")}
          </button>
        </section>
      ))}
    </div>
  );
}
