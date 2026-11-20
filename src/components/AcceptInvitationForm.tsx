"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { fieldClass, primaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";

export function AcceptInvitationForm({ token }: { token: string }) {
  const uid = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = String(new FormData(event.currentTarget).get("displayName") ?? "").trim();
    if (!displayName) return setError("Please enter your name.");
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, displayName }),
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
        {t.household.acceptTitle}
      </h2>
      <p className="mt-2 text-lg">{t.household.acceptIntro}</p>
      <label htmlFor={`${uid}-name`} className="mt-4 block text-lg font-semibold">
        {t.household.yourNameLabel}
      </label>
      <input
        id={`${uid}-name`}
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
        {t.household.acceptButton}
      </button>
    </form>
  );
}
