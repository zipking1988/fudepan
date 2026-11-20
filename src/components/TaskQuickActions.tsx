"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { fieldClass, secondaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";

/** Claim and assign from the board. The server re-checks every permission. */
export function TaskQuickActions(props: {
  taskId: string;
  taskTitle: string;
  canClaim: boolean;
  canAssign: boolean;
  assigneeId: string | null;
  members: { id: string; display_name: string }[];
}) {
  const uid = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState(props.assigneeId ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tasks/${props.taskId}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok)
        return setMessage({ ok: false, text: json?.error?.message ?? t.workflow.genericError });
      setMessage({ ok: true, text: t.workflow.done });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t.workflow.networkError });
    } finally {
      setBusy(false);
    }
  }

  if (!props.canClaim && !props.canAssign) return null;

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
      {props.canClaim ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ action: "claim" })}
          className={secondaryButton}
        >
          {t.workflow.actions.claim}
          <span className="sr-only">: {props.taskTitle}</span>
        </button>
      ) : null}
      {props.canAssign ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor={`${uid}-assign`} className="block text-lg font-semibold">
              {t.workflow.assignLabel}
              <span className="sr-only">: {props.taskTitle}</span>
            </label>
            <select
              id={`${uid}-assign`}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className={fieldClass}
            >
              <option value="">{t.workflow.unassigned}</option>
              {props.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled={busy || assignee === (props.assigneeId ?? "")}
            onClick={() => send({ action: "assign", assigneeId: assignee || null })}
            className={secondaryButton}
          >
            {t.workflow.actions.assign}
            <span className="sr-only">: {props.taskTitle}</span>
          </button>
        </div>
      ) : null}
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`w-full text-lg font-semibold ${message.ok ? "text-sage-800" : "text-danger"}`}
        >
          <span aria-hidden="true">{message.ok ? "✓ " : "⚠ "}</span>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
