"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { dangerButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";

export function RevokeInvitationButton({
  invitationId,
  label,
}: {
  invitationId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invitations/${invitationId}/revoke`, { method: "POST" });
      if (!res.ok) return setError(t.workflow.genericError);
      router.refresh();
    } catch {
      setError(t.workflow.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={revoke} disabled={busy} className={dangerButton}>
        {t.household.revoke}
        <span className="sr-only">: {label}</span>
      </button>
      {error ? (
        <p role="alert" className="text-lg font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </>
  );
}
