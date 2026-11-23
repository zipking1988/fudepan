"use client";

import { useId, useState, useSyncExternalStore, type FormEvent } from "react";

import { APPOINTMENT_LOCATION_MAX, timeZoneLabel, zonedTimeToInstant } from "@/lib/care/appointment";
import { AMOUNT_CURRENCIES, toMinorUnits, type AmountCurrency } from "@/lib/family/amount";
import { parseAppointmentQuote } from "@/lib/care/appointment-quote";
import type { EventPart, MissingDetailView } from "@/lib/family/shared-care-event";
import { formatDateTimeInZone } from "@/lib/i18n/format";
import type { MessageKey, Translator } from "@/lib/i18n/messages";

import { resultText, type ActionResult, type EventActions, type Runner } from "./event-runner";

const subscribeNever = () => () => {};

/** The device's IANA time zone. Null while rendering on the server, which cannot know it. */
export function useDeviceTimeZone(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );
}

type FormProps = {
  part: EventPart;
  tr: Translator;
  runner: Runner;
  actions: EventActions;
};

const FIELD = "app-input";

/** Hospital or clinic, date, time. The date and time may be prefilled from the note's own words. */
export function AppointmentForm({ part, tr, runner, actions }: FormProps) {
  const id = useId();
  const deviceZone = useDeviceTimeZone();
  const [suggestion] = useState(() => parseAppointmentQuote(part.sourceQuote));
  const [location, setLocation] = useState(part.location ?? "");
  const [date, setDate] = useState(suggestion?.date ?? "");
  const [time, setTime] = useState(suggestion?.time ?? "");
  const [zoneConfirmed, setZoneConfirmed] = useState(false);

  const usingSuggestion = suggestion !== null && date === suggestion.date && time === suggestion.time;
  const shown = (() => {
    if (!deviceZone) return null;
    const instant = zonedTimeToInstant(date, time, deviceZone);
    return instant.ok ? formatDateTimeInZone(instant.instant, deviceZone, tr.lang) : `${date} ${time}`;
  })();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!location.trim()) return runner.fail(tr.t("event.missing.needClinic"));
    if (!date) return runner.fail(tr.t("event.missing.needDate"));
    if (!time) return runner.fail(tr.t("event.missing.needTimeValue"));
    if (usingSuggestion && !zoneConfirmed) return runner.fail(tr.t("event.missing.zoneNeeded"));
    if (!deviceZone) return runner.fail(tr.t("event.missing.zoneReading"));
    // Fields keep what was typed so it can be corrected.
    runner.run(() =>
      actions.saveAppointment({
        stepId: part.id,
        location,
        localDate: date,
        localTime: time,
        timeZone: deviceZone,
      }),
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <div className="grid gap-1">
        <label htmlFor={`${id}-loc`} className="app-label">
          {tr.t("event.missing.clinic")} <span className="app-required">*</span>
        </label>
        <input
          id={`${id}-loc`}
          className={FIELD}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          required
          aria-required="true"
          maxLength={APPOINTMENT_LOCATION_MAX}
          disabled={runner.pending}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={`${id}-date`} className="app-label">
            {tr.t("event.missing.date")} <span className="app-required">*</span>
          </label>
          <input
            id={`${id}-date`}
            type="date"
            className={FIELD}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            aria-required="true"
            disabled={runner.pending}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-time`} className="app-label">
            {tr.t("event.missing.time")} <span className="app-required">*</span>
          </label>
          <input
            id={`${id}-time`}
            type="time"
            className={FIELD}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
            aria-required="true"
            aria-describedby={`${id}-zone`}
            disabled={runner.pending}
          />
        </div>
      </div>
      <p id={`${id}-zone`} className="app-hint">
        {deviceZone
          ? tr.t("event.missing.zoneHint", { zone: timeZoneLabel(deviceZone) })
          : tr.t("event.missing.zoneHintUnknown")}
      </p>
      {usingSuggestion && (
        <div className="grid gap-2 rounded border-2 border-amber-500 bg-amber-50 p-3">
          <p id={`${id}-suggested`}>
            <span className="font-semibold">{tr.t("label.needsAttention")}: </span>
            {tr.t("event.missing.appointmentFromNote")}
          </p>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={zoneConfirmed}
              onChange={(e) => setZoneConfirmed(e.target.checked)}
              disabled={runner.pending || !deviceZone}
              aria-describedby={`${id}-suggested`}
              className="mt-1 h-6 w-6"
            />
            <span>
              {deviceZone && shown
                ? tr.t("event.missing.zoneConfirm", { when: shown, zone: timeZoneLabel(deviceZone) })
                : tr.t("event.missing.zoneReading")}
            </span>
          </label>
        </div>
      )}
      <button type="submit" className="app-button" disabled={runner.pending}>
        {runner.pending ? tr.t("event.btn.working") : tr.t("event.missing.appointmentSave")}
      </button>
    </form>
  );
}

/** The amount a payment step needs, typed in whole and fractional currency units. */
export function AmountForm({ part, tr, runner, actions }: FormProps) {
  const id = useId();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<AmountCurrency>("JPY");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount.trim()) return runner.fail(tr.t("event.missing.needAmount"));
    const minor = toMinorUnits(amount, currency);
    if (minor === null) return runner.fail(tr.t("event.missing.amountInvalid"));
    runner.run(
      () => actions.savePartAmount({ stepId: part.id, amountMinor: minor, currency }),
      () => setAmount(""),
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={`${id}-amount`} className="app-label">
            {tr.t("event.missing.amount")} <span className="app-required">*</span>
          </label>
          <input
            id={`${id}-amount`}
            className={FIELD}
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            aria-required="true"
            aria-describedby={`${id}-amount-hint`}
            maxLength={14}
            disabled={runner.pending}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-currency`} className="app-label">
            {tr.t("event.missing.currency")}
          </label>
          <select
            id={`${id}-currency`}
            className={FIELD}
            value={currency}
            onChange={(e) => setCurrency(e.target.value as AmountCurrency)}
            disabled={runner.pending}
          >
            {AMOUNT_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p id={`${id}-amount-hint`} className="app-hint">
        {tr.t("event.missing.amountHint")}
      </p>
      <button type="submit" className="app-button" disabled={runner.pending}>
        {runner.pending ? tr.t("event.btn.working") : tr.t("event.missing.amountSave")}
      </button>
    </form>
  );
}

/** A deadline or reply-by time the person confirms in their own time zone. */
export function DeadlineForm({ part, tr, runner, actions }: FormProps) {
  const id = useId();
  const deviceZone = useDeviceTimeZone();
  const [kind, setKind] = useState<"task_due" | "respond_by">("task_due");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!date) return runner.fail(tr.t("event.missing.needDate"));
    if (!time) return runner.fail(tr.t("event.missing.needTimeValue"));
    if (!deviceZone) return runner.fail(tr.t("event.missing.zoneReading"));
    runner.run(() =>
      actions.confirmPartTime({ stepId: part.id, kind, localDate: date, localTime: time, timeZone: deviceZone }),
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      <div className="grid gap-1">
        <label htmlFor={`${id}-kind`} className="app-label">
          {tr.t("event.missing.deadlineKind")}
        </label>
        <select
          id={`${id}-kind`}
          className={FIELD}
          value={kind}
          onChange={(e) => setKind(e.target.value === "respond_by" ? "respond_by" : "task_due")}
          disabled={runner.pending}
        >
          <option value="task_due">{tr.t("event.missing.deadline.task_due")}</option>
          <option value="respond_by">{tr.t("event.missing.deadline.respond_by")}</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label htmlFor={`${id}-date`} className="app-label">
            {tr.t("event.missing.date")} <span className="app-required">*</span>
          </label>
          <input
            id={`${id}-date`}
            type="date"
            className={FIELD}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            aria-required="true"
            disabled={runner.pending}
          />
        </div>
        <div className="grid gap-1">
          <label htmlFor={`${id}-time`} className="app-label">
            {tr.t("event.missing.time")} <span className="app-required">*</span>
          </label>
          <input
            id={`${id}-time`}
            type="time"
            className={FIELD}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
            aria-required="true"
            aria-describedby={`${id}-zone`}
            disabled={runner.pending}
          />
        </div>
      </div>
      <p id={`${id}-zone`} className="app-hint">
        {deviceZone
          ? tr.t("event.missing.zoneHint", { zone: timeZoneLabel(deviceZone) })
          : tr.t("event.missing.zoneHintUnknown")}
      </p>
      <button type="submit" className="app-button" disabled={runner.pending}>
        {runner.pending ? tr.t("event.btn.working") : tr.t("event.missing.deadlineSave")}
      </button>
    </form>
  );
}

/** A free-text answer to one saved question. */
export function AnswerForm({
  detail,
  tr,
  runner,
  actions,
}: Omit<FormProps, "part"> & { detail: MissingDetailView }) {
  const id = useId();
  const [answer, setAnswer] = useState("");
  const detailId = detail.storedDetailId;
  if (detailId === null) return null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return runner.fail(tr.t("refusal.invalidInput"));
    runner.run(
      () => actions.resolveMissingDetail({ detailId, answer }),
      () => setAnswer(""),
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-2" noValidate>
      <label htmlFor={`${id}-answer`} className="app-label">
        {tr.t("event.missing.answer")} <span className="app-required">*</span>
      </label>
      <input
        id={`${id}-answer`}
        className={FIELD}
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        required
        aria-required="true"
        maxLength={500}
        disabled={runner.pending}
      />
      <button type="submit" className="app-button" disabled={runner.pending}>
        {runner.pending ? tr.t("event.btn.working") : tr.t("event.missing.save")}
      </button>
    </form>
  );
}

/** "Choose a person" select and one button. Used for hand over, assignment, and backup requests. */
export function PersonForm({
  label,
  button,
  receivers,
  tr,
  runner,
  onSubmit,
}: {
  label: string;
  button: string;
  receivers: readonly { id: string; name: string }[];
  tr: Translator;
  runner: Runner;
  onSubmit: (toMemberId: string) => Promise<ActionResult>;
}) {
  const id = useId();
  const [to, setTo] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!to) return runner.fail(tr.t("event.btn.choosePerson"));
    runner.run(() => onSubmit(to));
  }

  return (
    <form onSubmit={submit} className="grid gap-2" noValidate>
      <label htmlFor={`${id}-to`} className="app-label">
        {label}
      </label>
      <select
        id={`${id}-to`}
        className={FIELD}
        value={to}
        onChange={(e) => setTo(e.target.value)}
        disabled={runner.pending}
      >
        <option value="">{tr.t("event.btn.choosePerson")}</option>
        {receivers.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <button type="submit" className="app-button app-button--quiet" disabled={runner.pending}>
        {runner.pending ? tr.t("event.btn.working") : button}
      </button>
    </form>
  );
}

/** Resubmission: the Owner explains what changed. */
export function ResubmitForm({ part, tr, runner, actions }: FormProps) {
  const id = useId();
  const [explanation, setExplanation] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!explanation.trim()) return runner.fail(tr.t("refusal.resubmissionEmpty"));
    runner.run(() => actions.resubmitPart({ stepId: part.id, explanation }));
  }

  return (
    <form onSubmit={submit} className="grid gap-2" noValidate>
      <label htmlFor={`${id}-why`} className="app-label">
        {tr.t("event.resubmit.label")} <span className="app-required">*</span>
      </label>
      <p id={`${id}-hint`} className="app-hint">
        {tr.t("event.resubmit.hint")}
      </p>
      <textarea
        id={`${id}-why`}
        className={FIELD}
        rows={3}
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        required
        aria-required="true"
        aria-describedby={`${id}-hint`}
        maxLength={1000}
        disabled={runner.pending}
      />
      <button type="submit" className="app-button" disabled={runner.pending}>
        {runner.pending ? tr.t("event.btn.working") : tr.t("event.btn.resubmit")}
      </button>
    </form>
  );
}

/** Proof: a written note, or a photo or PDF uploaded to private storage. */
export function EvidenceForm({ part, tr, runner, actions }: FormProps) {
  const id = useId();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const label: MessageKey = "event.evidence.textDefaultLabel";

  function submitText(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return runner.fail(tr.t("refusal.invalidInput"));
    runner.run(
      () => actions.addTextEvidence({ stepId: part.id, label: tr.t(label), text }),
      () => setText(""),
    );
  }

  function submitFile(e: FormEvent) {
    e.preventDefault();
    if (!file) return runner.fail(tr.t("event.evidence.chooseFirst"));
    const chosen = file;
    runner.start(async () => {
      const prepared = await actions.prepareEvidenceUpload({
        stepId: part.id,
        kind: chosen.type === "application/pdf" ? "file" : "photo",
        contentType: chosen.type,
        sizeBytes: chosen.size,
      });
      if (!prepared.ok) {
        runner.say(resultText(tr, prepared));
        return;
      }
      const uploaded = await actions.uploadEvidenceFile(prepared.objectPath, prepared.token, chosen);
      if (!uploaded) {
        runner.fail(tr.t("evidence.notUploaded"));
        return;
      }
      const done = await actions.completeEvidenceUpload({
        stepId: part.id,
        label: chosen.name.slice(0, 200) || tr.t(label),
        objectPath: prepared.objectPath,
      });
      runner.say(done.ok ? { kind: "status", text: tr.t("event.evidence.saved") } : resultText(tr, done));
      if (done.ok) {
        setFile(null);
        runner.refresh();
      }
    });
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={submitText} className="grid gap-2" noValidate>
        <label htmlFor={`${id}-text`} className="app-label">
          {tr.t("event.evidence.textLabel")}
        </label>
        <textarea
          id={`${id}-text`}
          className={FIELD}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          disabled={runner.pending}
        />
        <button type="submit" className="app-button app-button--quiet" disabled={runner.pending}>
          {runner.pending ? tr.t("event.btn.working") : tr.t("event.evidence.saveText")}
        </button>
      </form>
      <form onSubmit={submitFile} className="grid gap-2" noValidate>
        <label htmlFor={`${id}-file`} className="app-label">
          {tr.t("event.evidence.fileLabel")}
        </label>
        <input
          id={`${id}-file`}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="app-file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={runner.pending}
        />
        <button type="submit" className="app-button app-button--quiet" disabled={runner.pending}>
          {runner.pending ? tr.t("event.evidence.uploading") : tr.t("event.evidence.upload")}
        </button>
      </form>
    </div>
  );
}
