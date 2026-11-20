"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import {
  EMPTY_TASK_VALUES,
  TaskFieldsForm,
  type TaskFieldValues,
} from "@/components/TaskFieldsForm";
import { primaryButton, secondaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { classifyRisk, detectCautions } from "@/lib/risk-rules";
import type { ExtractionField, ExtractionWarning } from "@/lib/task-schema";
import type { ExtractionResponse } from "@/server/api/tasks/extract";

export interface Member {
  id: string;
  display_name: string;
}

interface Suggestion {
  extractionId: string | null;
  status: ExtractionResponse["status"] | null;
  confidence: number | null;
  warnings: ExtractionWarning[];
  uncertainFields: ExtractionField[];
  suggestedName: string | null;
}

const NO_SUGGESTION: Suggestion = {
  extractionId: null,
  status: null,
  confidence: null,
  warnings: [],
  uncertainFields: [],
  suggestedName: null,
};

/** Warnings that are about the whole note rather than one field. */
const GENERAL_WARNINGS: ExtractionWarning[] = [
  "low_confidence",
  "low_ocr_confidence",
  "sensitive_masked",
  "extraction_failed",
  "extraction_unavailable",
  "no_text",
];

export function TaskReviewForm({
  noteId,
  members,
  noteText,
}: {
  noteId: string;
  members: Member[];
  /** Masked note text, used only for the client-side risk preview. The server recomputes risk. */
  noteText: string;
}) {
  const [values, setValues] = useState<TaskFieldValues>(EMPTY_TASK_VALUES);
  const [suggestion, setSuggestion] = useState<Suggestion>(NO_SUGGESTION);
  const [busy, setBusy] = useState<"suggest" | "save" | null>(null);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);

  const timeZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }, []);

  const aiConfidence =
    suggestion.extractionId && (suggestion.status === "ok" || suggestion.status === "needs_review")
      ? suggestion.confidence
      : ("manual" as const);
  const fieldText = [values.title, values.notes, values.location, noteText].join("\n");
  const risk = classifyRisk({
    category: values.category,
    text: fieldText,
    confidence: aiConfidence,
  });
  const fraud =
    suggestion.warnings.includes("possible_fraud") || detectCautions(fieldText).possibleFraud;

  async function suggest() {
    setBusy("suggest");
    setMessage(null);
    try {
      const res = await fetch(`/api/notes/${noteId}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timeZone }),
      });
      const json = (await res.json().catch(() => null)) as
        (ExtractionResponse & { error?: undefined }) | { error: { message?: string } } | null;
      if (!res.ok || !json || "error" in json) {
        setMessage({
          kind: "error",
          text: (json && "error" in json && json.error?.message) || t.review.genericError,
        });
        return;
      }
      setSuggestion({
        extractionId: json.extractionId,
        status: json.status,
        confidence: json.confidence,
        warnings: json.warnings,
        uncertainFields: json.task?.uncertainFields ?? [],
        suggestedName: json.task?.assigneeSuggestion ?? null,
      });
      if (json.task) {
        setValues({
          title: json.task.title,
          category: json.task.category,
          dueDate: json.task.dueDate ?? "",
          dueTime: json.task.dueTime ?? "",
          location: json.task.location ?? "",
          assigneeId: json.task.assigneeId ?? "",
          notes: json.task.notes ?? "",
        });
        setMessage({ kind: "info", text: t.review.suggestionDone });
      } else {
        setMessage({
          kind: "error",
          text:
            json.status === "unavailable"
              ? t.review.suggestionUnavailable
              : t.review.suggestionFailed,
        });
      }
    } catch {
      setMessage({ kind: "error", text: t.review.networkError });
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!values.title.trim()) {
      setTitleError(t.review.titleRequired);
      return;
    }
    setTitleError(null);
    setBusy("save");
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noteId,
          extractionId: suggestion.extractionId,
          timeZone,
          title: values.title.trim(),
          category: values.category,
          dueDate: values.dueDate || null,
          dueTime: values.dueTime || null,
          location: values.location.trim() || null,
          assigneeId: values.assigneeId || null,
          notes: values.notes.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        taskId?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.taskId) {
        setMessage({ kind: "error", text: json?.error?.message ?? t.review.genericError });
        return;
      }
      setSavedTaskId(json.taskId);
    } catch {
      setMessage({ kind: "error", text: t.review.networkError });
    } finally {
      setBusy(null);
    }
  }

  if (savedTaskId) {
    return (
      <section aria-labelledby="saved-title" className="paper-card border-sage-600 p-6">
        <h2 id="saved-title" className="text-2xl font-semibold">
          <span aria-hidden="true">✓ </span>
          {t.review.savedTitle}
        </h2>
        <p role="status" className="mt-2 text-lg">
          {t.review.savedBody}
        </p>
        <p className="mt-2 text-lg text-ink-soft">{t.review.nextStepBody}</p>
        <p className="mt-4">
          <Link href={`/tasks/${savedTaskId}`} className={primaryButton}>
            {t.review.savedLink}
          </Link>
        </p>
      </section>
    );
  }

  const general = suggestion.warnings.filter((w) => GENERAL_WARNINGS.includes(w));

  return (
    <div className="grid content-start gap-6">
      <section aria-labelledby="suggest-title" className="paper-card p-4 sm:p-6">
        <h2 id="suggest-title" className="text-2xl font-semibold">
          {t.review.suggestTitle}
        </h2>
        <p className="mt-2 text-lg text-ink-soft">{t.review.suggestBody}</p>
        <button
          type="button"
          onClick={suggest}
          disabled={busy !== null}
          className={`${secondaryButton} mt-4`}
        >
          {busy === "suggest"
            ? t.review.suggesting
            : suggestion.extractionId
              ? t.review.suggestAgain
              : t.review.suggestButton}
        </button>
        {message ? (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`mt-4 text-lg font-semibold ${message.kind === "error" ? "text-danger" : "text-sage-800"}`}
          >
            <span aria-hidden="true">{message.kind === "error" ? "⚠ " : "✓ "}</span>
            {message.text}
          </p>
        ) : null}
        {general.length > 0 ? (
          <ul className="mt-4 grid gap-2" aria-label={t.review.warningsTitle}>
            {general.map((w) => (
              <li
                key={w}
                className="flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-lg text-amber"
              >
                <span aria-hidden="true">⚠</span>
                {t.review.warnings[w]}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <TaskFieldsForm
        values={values}
        onChange={setValues}
        onSubmit={save}
        risk={risk}
        members={members}
        uncertainFields={suggestion.uncertainFields}
        warnings={suggestion.warnings}
        confidence={suggestion.confidence}
        suggestedName={suggestion.suggestedName}
        titleError={titleError}
        submitLabel={busy === "save" ? t.review.saving : t.review.save}
        busy={busy !== null}
        beforeSubmit={
          fraud ? (
            <p
              role="alert"
              className="mb-4 flex gap-2 rounded-md border-2 border-danger bg-danger-50 p-3 text-lg font-semibold text-danger"
            >
              <span aria-hidden="true">⚠</span>
              {t.review.warnings.possible_fraud}
            </p>
          ) : null
        }
      />
    </div>
  );
}
