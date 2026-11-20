"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { dangerButton, fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import type { RiskLevel, TaskCategory } from "@/lib/schemas/task";
import type { TaskAction } from "@/lib/workflow/transitions";

/**
 * Workflow buttons for one task. Only actions the server says are allowed are shown, and the
 * server checks them again. Approval needs an explicit checkbox; cancelling needs a reason.
 */
export function TaskActions(props: {
  taskId: string;
  actions: TaskAction[];
  risk: RiskLevel;
  category: TaskCategory;
  assigneeId: string | null;
  members: { id: string; display_name: string }[];
  waitingForApproval: boolean;
}) {
  const uid = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [ack, setAck] = useState(false);
  const [assignee, setAssignee] = useState(props.assigneeId ?? "");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const has = (a: TaskAction) => props.actions.includes(a);

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
      setAck(false);
      setCancelOpen(false);
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t.workflow.networkError });
    } finally {
      setBusy(false);
    }
  }

  const visible = props.actions.filter((a) => a !== "edit");
  return (
    <section aria-labelledby={`${uid}-title`} className="paper-card p-4 sm:p-6">
      <h2 id={`${uid}-title`} className="text-2xl font-semibold">
        {t.detail.actions}
      </h2>
      {props.waitingForApproval && !has("approve") ? (
        <p className="mt-3 text-lg">{t.workflow.waitingForApproval}</p>
      ) : null}
      {visible.length === 0 ? <p className="mt-3 text-lg">{t.workflow.noPermission}</p> : null}

      <div className="mt-4 grid gap-6">
        {has("approve") ? (
          <div className="rounded-md border-l-8 border-sage-600 bg-sage-50 p-4">
            {props.risk === "high" ? (
              <p className="flex gap-2 text-lg font-semibold">
                <span aria-hidden="true">⚠</span>
                {t.workflow.approveRiskHigh}
              </p>
            ) : null}
            <p id={`${uid}-approve-help`} className="mt-2 text-lg">
              {t.workflow.approveHelp}
              {props.category === "payment" ? ` ${t.workflow.approvePayment}` : ""}
            </p>
            <div className="mt-3 flex items-start gap-3">
              <input
                id={`${uid}-ack`}
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
                className="mt-1 h-7 w-7 shrink-0 accent-sage-800"
              />
              <label htmlFor={`${uid}-ack`} className="text-lg font-semibold">
                {t.workflow.approveCheck}
              </label>
            </div>
            <button
              type="button"
              disabled={busy || !ack}
              aria-describedby={`${uid}-approve-help`}
              onClick={() => send({ action: "approve", acknowledged: true })}
              className={`${primaryButton} mt-4`}
            >
              {t.workflow.actions.approve}
            </button>
          </div>
        ) : null}

        {has("reject") ? (
          <div>
            <label htmlFor={`${uid}-reject`} className="block text-lg font-semibold">
              {t.workflow.rejectReasonLabel}
            </label>
            <input
              id={`${uid}-reject`}
              type="text"
              maxLength={500}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className={fieldClass}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                send({
                  action: "reject",
                  ...(rejectReason.trim() ? { reason: rejectReason.trim() } : {}),
                })
              }
              className={`${dangerButton} mt-3`}
            >
              {t.workflow.actions.reject}
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          {has("submit") ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ action: "submit" })}
              className={primaryButton}
            >
              {t.workflow.actions.submit}
            </button>
          ) : null}
          {has("claim") ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ action: "claim" })}
              className={secondaryButton}
            >
              {t.workflow.actions.claim}
            </button>
          ) : null}
          {has("complete") ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ action: "complete" })}
              className={primaryButton}
            >
              {t.workflow.actions.complete}
            </button>
          ) : null}
        </div>

        {has("assign") ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-60">
              <label htmlFor={`${uid}-assign`} className="block text-lg font-semibold">
                {t.workflow.assignLabel}
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
            </button>
          </div>
        ) : null}

        {has("cancel") ? (
          cancelOpen ? (
            <div className="rounded-md border-2 border-danger p-4">
              <label htmlFor={`${uid}-cancel`} className="block text-lg font-semibold">
                {t.workflow.cancelReasonLabel}
              </label>
              <input
                id={`${uid}-cancel`}
                type="text"
                required
                maxLength={500}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                className={fieldClass}
              />
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy || !cancelReason.trim()}
                  onClick={() => send({ action: "cancel", reason: cancelReason.trim() })}
                  className={dangerButton}
                >
                  {t.workflow.actions.confirmCancel}
                </button>
                <button
                  type="button"
                  onClick={() => setCancelOpen(false)}
                  className={secondaryButton}
                >
                  {t.workflow.keepTask}
                </button>
              </div>
            </div>
          ) : (
            <p>
              <button type="button" onClick={() => setCancelOpen(true)} className={dangerButton}>
                {t.workflow.actions.cancel}
              </button>
            </p>
          )
        ) : null}
      </div>

      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={`mt-4 text-lg font-semibold ${message.ok ? "text-sage-800" : "text-danger"}`}
        >
          <span aria-hidden="true">{message.ok ? "✓ " : "⚠ "}</span>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
