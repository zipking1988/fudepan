"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n/messages";
import { fieldClass, primaryButton } from "@/components/ui";

export function CreateHouseholdForm() {
  const uid = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const displayName = String(form.get("displayName") ?? "").trim();
    if (!name || !displayName) return setError("Please fill in both names.");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/households", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, displayName }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) return setError(json?.error?.message ?? t.workflow.genericError);
      router.push("/");
      router.refresh();
    } catch {
      setError(t.workflow.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-labelledby={`${uid}-title`}
      className="paper-card p-4 sm:p-6"
    >
      <h2 id={`${uid}-title`} className="text-2xl font-semibold">
        {t.household.createTitle}
      </h2>
      <p className="mt-2 text-lg">{t.household.createIntro}</p>
      <label htmlFor={`${uid}-name`} className="mt-4 block text-lg font-semibold">
        {t.household.nameLabel}
      </label>
      <input
        id={`${uid}-name`}
        name="name"
        type="text"
        required
        maxLength={100}
        className={fieldClass}
      />
      <label htmlFor={`${uid}-display`} className="mt-4 block text-lg font-semibold">
        {t.household.yourNameLabel}
      </label>
      <input
        id={`${uid}-display`}
        name="displayName"
        type="text"
        required
        maxLength={100}
        autoComplete="name"
        className={fieldClass}
      />
      {error ? (
        <p role="alert" className="mt-4 text-lg font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={`${primaryButton} mt-4`}>
        {busy ? t.household.creating : t.household.create}
      </button>
    </form>
  );
}
