"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { setLanguage } from "@/app/(family)/family/actions";
import { createTranslator, isMessageKey, type Language } from "@/lib/i18n/messages";
import { LanguageFormView, type LanguageStatus } from "./language-form-view";

/** Saves the Member's language, then refreshes so the next render uses it. */
export function LanguageForm({ householdId, language }: { householdId: string; language: Language }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Language>(language);
  const [status, setStatus] = useState<LanguageStatus>(null);
  const [pending, startTransition] = useTransition();
  const tr = useMemo(() => createTranslator(language), [language]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await setLanguage({ householdId, language: selected });
        if (result.ok) {
          // The confirmation is written in the language that was just chosen.
          setStatus({ kind: "saved", text: createTranslator(selected).t("language.saved") });
          router.refresh();
        } else {
          setStatus({
            kind: "error",
            text: tr.t(isMessageKey(result.messageKey) ? result.messageKey : "refusal.error"),
          });
        }
      } catch {
        setStatus({ kind: "error", text: tr.t("refusal.error") });
      }
    });
  }

  return (
    <LanguageFormView
      tr={tr}
      selected={selected}
      pending={pending}
      status={status}
      onChange={(event) => setSelected(event.currentTarget.value === "ja" ? "ja" : "en")}
      onSubmit={handleSubmit}
    />
  );
}
