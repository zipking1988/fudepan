"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TaskFieldsForm, type TaskFieldValues } from "@/components/TaskFieldsForm";
import { zonedToIso } from "@/lib/datetime";
import { t } from "@/lib/i18n/messages";
import { classifyRisk } from "@/lib/risk-rules";
import { DEFAULT_DUE_TIME } from "@/lib/datetime";

/** Edits a draft or awaiting-approval task through PATCH /api/tasks/[id]. */
export function TaskEditForm(props: {
  taskId: string;
  initial: TaskFieldValues;
  timeZone: string;
  members: { id: string; display_name: string }[];
  noteText: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const risk = classifyRisk({
    category: values.category,
    text: [values.title, values.notes, values.location, props.noteText].join("\n"),
    confidence: "manual",
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.title.trim()) return setTitleError(t.review.titleRequired);
    setTitleError(null);
    const timeDefaulted = Boolean(values.dueDate) && !values.dueTime;
    const dueAt = values.dueDate
      ? zonedToIso(values.dueDate, values.dueTime || DEFAULT_DUE_TIME, props.timeZone)
      : null;
    if (values.dueDate && !dueAt)
      return setMessage({ ok: false, text: t.review.warnings.invalid_date });

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tasks/${props.taskId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          timeDefaulted,
          changes: {
            title: values.title.trim(),
            category: values.category,
            dueAt,
            location: values.location.trim() || null,
            assigneeId: values.assigneeId || null,
            notes: values.notes.trim() || null,
          },
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok)
        return setMessage({ ok: false, text: json?.error?.message ?? t.workflow.genericError });
      setMessage({ ok: true, text: t.workflow.done });
      setOpen(false);
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t.workflow.networkError });
    } finally {
      setBusy(false);
    }
  }

  const status = message ? (
    <p
      role={message.ok ? "status" : "alert"}
      className={`mt-4 text-lg font-semibold ${message.ok ? "text-sage-800" : "text-danger"}`}
    >
      <span aria-hidden="true">{message.ok ? "✓ " : "⚠ "}</span>
      {message.text}
    </p>
  ) : null;

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setValues(props.initial);
            setOpen(true);
          }}
          className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-md border-2 border-sage-800 bg-paper px-6 py-3 text-lg font-semibold text-sage-800 hover:bg-sage-100"
        >
          {t.workflow.actions.edit}
        </button>
        {status}
      </div>
    );
  }

  return (
    <TaskFieldsForm
      values={values}
      onChange={setValues}
      onSubmit={onSubmit}
      risk={risk}
      members={props.members}
      uncertainFields={[]}
      warnings={[]}
      confidence={null}
      suggestedName={null}
      titleError={titleError}
      submitLabel={busy ? t.review.saving : t.workflow.saveChanges}
      submitHelp={t.workflow.editHelp}
      busy={busy}
      afterSubmit={
        <>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-3 inline-flex min-h-12 items-center rounded-md px-4 text-lg font-semibold text-sage-800 underline"
          >
            {t.workflow.closeEdit}
          </button>
          {status}
        </>
      }
    />
  );
}
