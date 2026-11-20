"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { fieldClass, primaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { ROLES, type Role } from "@/lib/permissions";

export function InviteForm() {
  const uid = useId();
  const router = useRouter();
  const [role, setRole] = useState<Role>("caregiver");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setError(null);
    setLink(null);
    setBusy(true);
    try {
      const res = await fetch("/api/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, email: email || null }),
      });
      const json = (await res.json().catch(() => null)) as {
        url?: string;
        expiresAt?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.url || !json.expiresAt)
        return setError(json?.error?.message ?? t.workflow.genericError);
      setLink({ url: json.url, expiresAt: json.expiresAt });
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
        {t.household.inviteTitle}
      </h2>
      <p className="mt-2 text-lg">{t.household.inviteIntro}</p>

      <label htmlFor={`${uid}-role`} className="mt-4 block text-lg font-semibold">
        {t.household.inviteRoleLabel}
      </label>
      <select
        id={`${uid}-role`}
        value={role}
        onChange={(e) => setRole(e.target.value as Role)}
        aria-describedby={`${uid}-role-help`}
        className={fieldClass}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {t.household.roles[r]}
          </option>
        ))}
      </select>
      <p id={`${uid}-role-help`} className="mt-2 text-lg">
        {t.household.roleHelp[role]}
      </p>

      <label htmlFor={`${uid}-email`} className="mt-4 block text-lg font-semibold">
        {t.household.inviteEmailLabel}
      </label>
      <input
        id={`${uid}-email`}
        name="email"
        type="email"
        autoComplete="off"
        maxLength={254}
        aria-describedby={`${uid}-email-help`}
        className={fieldClass}
      />
      <p id={`${uid}-email-help`} className="mt-2 text-lg">
        {t.household.inviteEmailHelp}
      </p>

      {error ? (
        <p role="alert" className="mt-4 text-lg font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={`${primaryButton} mt-4`}>
        {t.household.inviteCreate}
      </button>

      {link ? (
        <div role="status" className="mt-4 rounded-md border-2 border-green-800 bg-green-50 p-4">
          <p className="text-lg font-semibold">
            <span aria-hidden="true">✓ </span>
            {t.household.inviteCreated}
          </p>
          <label htmlFor={`${uid}-link`} className="mt-2 block text-lg font-semibold">
            {t.household.inviteLinkLabel}
          </label>
          <input
            id={`${uid}-link`}
            readOnly
            value={link.url}
            onFocus={(e) => e.currentTarget.select()}
            className={fieldClass}
            data-testid="invite-link"
          />
          <p className="mt-2 text-lg">
            {t.household.expires}:{" "}
            {new Date(link.expiresAt).toLocaleDateString("en", { dateStyle: "medium" })}
          </p>
        </div>
      ) : null}
    </form>
  );
}
