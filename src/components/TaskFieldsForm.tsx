"use client";

import { useId, type FormEvent, type ReactNode } from "react";
import { FieldNote } from "@/components/FieldNote";
import { RiskBadge } from "@/components/RiskBadge";
import { fieldClass, primaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import type { RiskAssessment } from "@/lib/risk-rules";
import { TASK_CATEGORIES, type TaskCategory } from "@/lib/schemas/task";
import type { ExtractionField, ExtractionWarning } from "@/lib/task-schema";

export interface TaskFieldValues {
  title: string;
  category: TaskCategory;
  dueDate: string;
  dueTime: string;
  location: string;
  assigneeId: string;
  notes: string;
}

export const EMPTY_TASK_VALUES: TaskFieldValues = {
  title: "",
  category: "other",
  dueDate: "",
  dueTime: "",
  location: "",
  assigneeId: "",
  notes: "",
};

export type FieldKey =
  "title" | "category" | "dueDate" | "dueTime" | "location" | "assignee" | "notes";

/** Maps extraction warnings and uncertain fields to the field each one is about. */
export function fieldWarnings(
  values: TaskFieldValues,
  uncertain: readonly ExtractionField[],
  warnings: readonly ExtractionWarning[],
): Partial<Record<FieldKey, string[]>> {
  const out: Partial<Record<FieldKey, string[]>> = {};
  const add = (k: FieldKey, msg: string) => (out[k] ??= []).push(msg);
  const map: Record<ExtractionField, FieldKey> = {
    title: "title",
    category: "category",
    dueDate: "dueDate",
    dueTime: "dueTime",
    location: "location",
    assigneeSuggestion: "assignee",
    notes: "notes",
  };
  for (const f of uncertain) add(map[f], t.review.fieldWarnings.uncertain);
  if (warnings.includes("category_adjusted"))
    add("category", t.review.fieldWarnings.category_adjusted);
  if (warnings.includes("date_in_past")) add("dueDate", t.review.fieldWarnings.date_in_past);
  if (warnings.includes("invalid_date")) add("dueDate", t.review.fieldWarnings.invalid_date);
  if (values.dueDate && !values.dueTime) add("dueTime", t.review.fieldWarnings.time_not_given);
  return out;
}

const riskText = (level: RiskAssessment["level"]) =>
  level === "high"
    ? t.review.riskHigh
    : level === "medium"
      ? t.review.riskMedium
      : t.review.riskLow;

/**
 * Editable task fields with warnings beside the field they concern and the risk level beside the
 * category. Used by the real review screen and by the example. It does no network calls itself.
 */
export function TaskFieldsForm(props: {
  values: TaskFieldValues;
  onChange: (values: TaskFieldValues) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  risk: RiskAssessment;
  members: readonly { id: string; display_name: string }[];
  uncertainFields: readonly ExtractionField[];
  warnings: readonly ExtractionWarning[];
  /** Extra explanations shown under specific fields (used by the example). */
  extraNotes?: Partial<Record<FieldKey, string>>;
  /** Neutral helper text under specific fields, e.g. an English gloss (used by the example). */
  fieldHints?: Partial<Record<FieldKey, string>>;
  confidence: number | null;
  suggestedName: string | null;
  titleError: string | null;
  submitLabel: string;
  /** Text under the submit button. Defaults to the draft explanation. */
  submitHelp?: string;
  busy: boolean;
  /** Shown above the submit button, e.g. a scam caution. */
  beforeSubmit?: ReactNode;
  /** Shown below the submit button. */
  afterSubmit?: ReactNode;
}) {
  const uid = useId();
  const { values } = props;
  const notes = fieldWarnings(values, props.uncertainFields, props.warnings);
  for (const [key, text] of Object.entries(props.extraNotes ?? {}) as [FieldKey, string][]) {
    (notes[key] ??= []).push(text);
  }
  const set = <K extends keyof TaskFieldValues>(key: K, value: TaskFieldValues[K]) =>
    props.onChange({ ...values, [key]: value });

  const hints = props.fieldHints ?? {};
  const describe = (key: FieldKey, extra?: string) =>
    [
      hints[key] ? `${uid}-${key}-hint` : null,
      notes[key]?.length ? `${uid}-${key}-note` : null,
      extra,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const note = (key: FieldKey) => (
    <>
      {hints[key] ? (
        <p id={`${uid}-${key}-hint`} className="mt-2 text-lg text-ink-soft">
          {hints[key]}
        </p>
      ) : null}
      {notes[key]?.length ? (
        <FieldNote id={`${uid}-${key}-note`}>{notes[key]!.join(" ")}</FieldNote>
      ) : null}
    </>
  );
  const label = (key: FieldKey, htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className="flex flex-wrap items-center gap-2 text-lg font-semibold">
      {text}
      {notes[key]?.length ? (
        <span className="rounded-full border border-amber px-2 text-base font-semibold text-amber">
          <span aria-hidden="true">⚠ </span>
          {t.review.uncertain}
        </span>
      ) : null}
    </label>
  );

  return (
    <form
      onSubmit={props.onSubmit}
      noValidate
      aria-labelledby={`${uid}-title-h`}
      className="paper-card p-4 sm:p-6"
    >
      <h2 id={`${uid}-title-h`} className="text-2xl font-semibold">
        {t.review.formTitle}
      </h2>
      {props.confidence !== null ? (
        <p className="mt-2 text-lg text-ink-soft">
          {t.review.confidence}:{" "}
          <strong className="text-ink">{Math.round(props.confidence * 100)}%</strong>
        </p>
      ) : null}

      <div className="mt-6 grid gap-6">
        <div>
          {label("title", `${uid}-title`, t.review.fields.title)}
          <input
            id={`${uid}-title`}
            type="text"
            required
            maxLength={200}
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            aria-invalid={props.titleError ? true : undefined}
            aria-describedby={describe(
              "title",
              props.titleError ? `${uid}-title-error` : undefined,
            )}
            className={fieldClass}
          />
          {note("title")}
          {props.titleError ? (
            <p
              id={`${uid}-title-error`}
              role="alert"
              className="mt-2 text-lg font-semibold text-danger"
            >
              <span aria-hidden="true">⚠ </span>
              {props.titleError}
            </p>
          ) : null}
        </div>

        <div>
          {label("category", `${uid}-category`, t.review.fields.category)}
          <select
            id={`${uid}-category`}
            value={values.category}
            onChange={(e) => set("category", e.target.value as TaskCategory)}
            aria-describedby={describe("category", `${uid}-risk`)}
            className={fieldClass}
          >
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t.review.categories[c]}
              </option>
            ))}
          </select>
          {note("category")}
          <div
            id={`${uid}-risk`}
            aria-live="polite"
            className="mt-3 flex flex-wrap items-start gap-3"
          >
            <RiskBadge level={props.risk.level} />
            <p className="text-lg text-ink-soft">{riskText(props.risk.level)}</p>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            {label("dueDate", `${uid}-date`, t.review.fields.dueDate)}
            <input
              id={`${uid}-date`}
              type="date"
              value={values.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              aria-describedby={describe("dueDate")}
              className={fieldClass}
            />
            {note("dueDate")}
          </div>
          <div>
            {label("dueTime", `${uid}-time`, t.review.fields.dueTime)}
            <input
              id={`${uid}-time`}
              type="time"
              value={values.dueTime}
              onChange={(e) => set("dueTime", e.target.value)}
              aria-describedby={describe("dueTime", `${uid}-due-help`)}
              className={fieldClass}
            />
            {note("dueTime")}
          </div>
        </div>
        <p id={`${uid}-due-help`} className="-mt-3 text-lg text-ink-soft">
          {t.review.fields.dueHelp}
        </p>

        <div>
          {label("location", `${uid}-location`, t.review.fields.location)}
          <input
            id={`${uid}-location`}
            type="text"
            maxLength={200}
            value={values.location}
            onChange={(e) => set("location", e.target.value)}
            aria-describedby={describe("location")}
            className={fieldClass}
          />
          {note("location")}
        </div>

        <div>
          {label("assignee", `${uid}-assignee`, t.review.fields.assignee)}
          <select
            id={`${uid}-assignee`}
            value={values.assigneeId}
            onChange={(e) => set("assigneeId", e.target.value)}
            aria-describedby={describe(
              "assignee",
              props.suggestedName ? `${uid}-assignee-help` : undefined,
            )}
            className={fieldClass}
          >
            <option value="">{t.review.fields.assigneeNone}</option>
            {props.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
          {props.suggestedName ? (
            <p id={`${uid}-assignee-help`} className="mt-2 text-lg text-ink-soft">
              {t.review.fields.assigneeSuggested}:{" "}
              <strong className="text-ink">{props.suggestedName}</strong>
            </p>
          ) : null}
          {note("assignee")}
        </div>

        <div>
          {label("notes", `${uid}-notes`, t.review.fields.notes)}
          <textarea
            id={`${uid}-notes`}
            rows={4}
            maxLength={2000}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            aria-describedby={describe("notes")}
            className={fieldClass}
          />
          {note("notes")}
        </div>
      </div>

      <div className="mt-8 border-t border-line pt-6">
        {props.beforeSubmit}
        <button
          type="submit"
          disabled={props.busy}
          aria-describedby={`${uid}-save-help`}
          className={primaryButton}
        >
          {props.submitLabel}
        </button>
        <p id={`${uid}-save-help`} className="mt-3 text-lg text-ink-soft">
          {props.submitHelp ?? t.review.saveHelp}
        </p>
        {props.afterSubmit}
      </div>
    </form>
  );
}
