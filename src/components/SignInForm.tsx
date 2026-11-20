"use client";

import { useId, useState, type FormEvent } from "react";
import { t } from "@/lib/i18n/messages";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/browser";

export function SignInForm({ next }: { next?: string }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email) return setError(t.auth.emailRequired);
    setError(null);
    setState("sending");
    try {
      const supabase = createClient();
      const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirect },
      });
      if (signInError) {
        setError(t.auth.sendFailed);
        setState("idle");
        return;
      }
      setState("sent");
    } catch {
      setError(t.auth.sendFailed);
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <p role="status" className="rounded-lg border-2 border-green-800 bg-green-50 p-4 text-lg">
        <span aria-hidden="true">✓ </span>
        {t.auth.sent}
      </p>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-label={t.auth.title}
      className="paper-card p-4 sm:p-6"
    >
      <label htmlFor={id} className="block text-lg font-semibold">
        {t.auth.emailLabel}
      </label>
      <input
        id={id}
        name="email"
        type="email"
        autoComplete="email"
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-2 block min-h-12 w-full rounded-md border-2 border-edge p-3 text-lg"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-lg font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-4 inline-flex min-h-12 min-w-12 items-center justify-center rounded-md bg-sage-800 px-6 py-3 text-lg font-semibold text-white hover:bg-sage-900 disabled:bg-ink-soft"
      >
        {state === "sending" ? t.auth.sending : t.auth.send}
      </button>
    </form>
  );
}
