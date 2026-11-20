"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { secondaryButton, fieldClass } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { ROLES, type Role } from "@/lib/permissions";

export function MemberRoleForm({
  memberId,
  name,
  role,
}: {
  memberId: string;
  name: string;
  role: Role;
}) {
  const uid = useId();
  const router = useRouter();
  const [value, setValue] = useState<Role>(role);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/members/${memberId}/role`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: value }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok)
        return setMessage({ ok: false, text: json?.error?.message ?? t.workflow.genericError });
      setMessage({ ok: true, text: t.household.roleChanged });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t.workflow.networkError });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={uid} className="block text-lg font-semibold">
          {t.household.roleLabel}: {name}
        </label>
        <select
          id={uid}
          value={value}
          onChange={(e) => setValue(e.target.value as Role)}
          className={fieldClass}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t.household.roles[r]}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={busy || value === role} className={secondaryButton}>
        {t.household.changeRole}
        <span className="sr-only">: {name}</span>
      </button>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`text-lg font-semibold ${message.ok ? "" : "text-danger"}`}
        >
          <span aria-hidden="true">{message.ok ? "✓ " : "⚠ "}</span>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
