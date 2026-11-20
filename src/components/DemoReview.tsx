"use client";

import { useState, type FormEvent } from "react";
import { TaskFieldsForm, type TaskFieldValues } from "@/components/TaskFieldsForm";
import { DEMO_GLOSSES, DEMO_MEMBERS, DEMO_NOTE_TEXT, DEMO_SUGGESTION } from "@/lib/demo/fixtures";
import { t } from "@/lib/i18n/messages";
import { classifyRisk } from "@/lib/risk-rules";

/**
 * The example review screen. Everything runs in the browser with fictional data: no API call, no
 * AI call, no database write. "Save" only explains that nothing was saved.
 *
 * Semantics kept honest: Aki is a suggestion (nobody is assigned), 5:00 PM is a deadline, the date
 * comes from a visible reference date, and no confidence percentage is shown.
 */
export function DemoReview({ dueDate }: { dueDate: string }) {
  const [values, setValues] = useState<TaskFieldValues>({
    title: DEMO_SUGGESTION.title,
    category: DEMO_SUGGESTION.category,
    dueDate,
    dueTime: DEMO_SUGGESTION.dueTime,
    location: DEMO_SUGGESTION.location,
    assigneeId: "",
    notes: DEMO_SUGGESTION.notes,
  });
  const [titleError, setTitleError] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);

  const risk = classifyRisk({
    category: values.category,
    text: [values.title, values.notes, values.location, DEMO_NOTE_TEXT].join("\n"),
    // The example makes no claim about how sure the reading is, so it counts as unconfirmed.
    confidence: null,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values.title.trim()) {
      setTitleError(t.review.titleRequired);
      setNotice(false);
      return;
    }
    setTitleError(null);
    setNotice(true);
  }

  return (
    <TaskFieldsForm
      values={values}
      onChange={(v) => {
        setValues(v);
        setNotice(false);
      }}
      onSubmit={onSubmit}
      risk={risk}
      members={DEMO_MEMBERS}
      uncertainFields={DEMO_SUGGESTION.uncertainFields}
      warnings={DEMO_SUGGESTION.warnings}
      extraNotes={{
        dueDate: t.demo.dueDateNote,
        dueTime: t.demo.deadlineNote,
        assignee: t.demo.assigneeNote,
      }}
      fieldHints={{
        title: DEMO_GLOSSES.title,
        location: DEMO_GLOSSES.location,
        notes: DEMO_GLOSSES.notes,
      }}
      confidence={null}
      suggestedName={DEMO_SUGGESTION.assigneeSuggestion}
      titleError={titleError}
      submitLabel={t.demo.save}
      busy={false}
      afterSubmit={
        <>
          {risk.level === "high" ? (
            <p className="mt-4 rounded-md border-l-8 border-sage-600 bg-sage-50 p-3 text-lg">
              {t.demo.approvalNote}
            </p>
          ) : null}
          {notice ? (
            <p
              role="status"
              className="mt-4 rounded-md border-2 border-edge bg-paper-shade p-3 text-lg font-semibold"
            >
              <span aria-hidden="true">ℹ </span>
              {t.demo.saved}
            </p>
          ) : null}
        </>
      }
    />
  );
}
