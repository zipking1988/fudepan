"use client";

import { useState, useSyncExternalStore, useTransition } from "react";

import {
  APPOINTMENT_LOCATION_MAX,
  buildAppointmentClarificationInput,
  timeZoneLabel,
  zonedTimeToInstant,
} from "@/lib/care/appointment";
import { parseAppointmentQuote } from "@/lib/care/appointment-quote";
import { canOfferCompletion, isAwaitingApproval } from "@/lib/care/step-state";
import { formatDateTimeInZone } from "@/lib/format-date";
import type { CareStepDetail, MemberOption } from "@/lib/care/queries";

import { addTextEvidence, approveStep, assignStepOwner, completeStep, saveAppointmentClarification } from "../actions";

type Props = {
  step: CareStepDetail;
  members: MemberOption[];
};

const subscribeNever = () => () => {};

/** The device's IANA time zone. Null during server rendering, which cannot know it. */
function useDeviceTimeZone(): string | null {
  return useSyncExternalStore(
    subscribeNever,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    () => null,
  );
}

export function CareChainActions({ step, members }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedOwner, setSelectedOwner] = useState(step.ownerId ?? "");
  const [selectedBackup, setSelectedBackup] = useState(step.backupOwnerId ?? "");
  const [evidenceText, setEvidenceText] = useState("");
  
  // Appointment clarification state
  const [appointmentLocation, setAppointmentLocation] = useState(step.appointmentLocation ?? "");
  // Prefilled only from an explicit date and local clock time in the note's
  // own words. It has no time zone until the person confirms one.
  const [quoteSuggestion] = useState(() =>
    step.careCategory === "appointment" ? parseAppointmentQuote(step.sourceQuote) : null,
  );
  const [appointmentDate, setAppointmentDate] = useState(quoteSuggestion?.date ?? "");
  const [appointmentTime, setAppointmentTime] = useState(quoteSuggestion?.time ?? "");
  const [zoneConfirmed, setZoneConfirmed] = useState(false);
  const deviceTimeZone = useDeviceTimeZone();
  const usingQuoteSuggestion =
    quoteSuggestion !== null &&
    appointmentDate === quoteSuggestion.date &&
    appointmentTime === quoteSuggestion.time;

  // Check if this step needs appointment clarification
  const isAppointment = step.careCategory === "appointment";
  const hasAppointmentDetails = step.appointmentLocation && step.appointmentTime;
  const needsAppointmentClarification = isAppointment && !hasAppointmentDetails;

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  function handleAssign() {
    clearMessages();
    startTransition(async () => {
      const result = await assignStepOwner({
        stepId: step.id,
        ownerId: selectedOwner || null,
        backupOwnerId: selectedBackup || null,
      });
      if (result.ok) {
        setSuccess(result.message ?? "Responsibility saved.");
      } else {
        setError(result.error);
      }
    });
  }

  function handleApprove() {
    clearMessages();
    startTransition(async () => {
      const result = await approveStep({ stepId: step.id });
      if (result.ok) {
        setSuccess(result.message ?? "Step confirmed. It is now approved for action.");
      } else {
        setError(result.error);
      }
    });
  }

  function handleComplete() {
    clearMessages();
    startTransition(async () => {
      const result = await completeStep({ stepId: step.id });
      if (result.ok) {
        setSuccess(result.message ?? "Step marked as completed.");
      } else {
        setError(result.error);
      }
    });
  }

  function handleSaveAppointment() {
    clearMessages();
    if (usingQuoteSuggestion && !zoneConfirmed) {
      setError(
        "Please confirm the date and time from the note are in the time zone shown, or change them, before saving.",
      );
      return;
    }
    // Builds an ISO instant ("…Z") plus the IANA zone; the server re-checks both.
    const built = buildAppointmentClarificationInput({
      stepId: step.id,
      location: appointmentLocation,
      localDate: appointmentDate,
      localTime: appointmentTime,
      timeZone: deviceTimeZone,
    });
    if (!built.ok) {
      // Fields keep what was typed so it can be corrected.
      setError(built.error);
      return;
    }
    startTransition(async () => {
      const result = await saveAppointmentClarification(built.input);
      if (result.ok) {
        setSuccess("Appointment details saved. They now show on this step and in the timeline.");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="grid gap-4 border-t pt-4">
      {error && (
        <div role="alert" className="app-alert">
          <p className="app-alert__title">Could not save</p>
          <p>{error}</p>
        </div>
      )}
      {success && (
        <div role="status" className="app-success" tabIndex={-1}>
          {success}
        </div>
      )}

      {/* Appointment clarification for appointment steps with unknown details */}
      {needsAppointmentClarification && (
        <fieldset
          className="grid gap-3 border rounded-lg p-4 bg-blue-50"
          aria-describedby={`appt-why-${step.id}`}
        >
          <legend className="font-semibold px-1">Missing appointment information</legend>
          <p id={`appt-why-${step.id}`} className="app-hint">
            Add which hospital or clinic, and the date and time of the appointment, so the family
            knows when and where to go. The words from the note stay as they are.
          </p>

          <div className="grid gap-2">
            <label htmlFor={`appt-location-${step.id}`} className="app-label">
              Hospital or clinic name <span className="app-hint font-normal">(required)</span>
            </label>
            <input
              id={`appt-location-${step.id}`}
              type="text"
              value={appointmentLocation}
              onChange={(e) => setAppointmentLocation(e.target.value)}
              className="app-input"
              placeholder="e.g., City General Hospital"
              disabled={isPending}
              maxLength={APPOINTMENT_LOCATION_MAX}
              required
              aria-required="true"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <label htmlFor={`appt-date-${step.id}`} className="app-label">
                Date <span className="app-hint font-normal">(required)</span>
              </label>
              <input
                id={`appt-date-${step.id}`}
                type="date"
                value={appointmentDate}
                onChange={(e) => {
                  setAppointmentDate(e.target.value);
                  setZoneConfirmed(false);
                }}
                className="app-input"
                disabled={isPending}
                required
                aria-required="true"
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor={`appt-time-${step.id}`} className="app-label">
                Time <span className="app-hint font-normal">(required)</span>
              </label>
              <input
                id={`appt-time-${step.id}`}
                type="time"
                value={appointmentTime}
                onChange={(e) => {
                  setAppointmentTime(e.target.value);
                  setZoneConfirmed(false);
                }}
                className="app-input"
                disabled={isPending}
                required
                aria-required="true"
                aria-describedby={`appt-zone-${step.id}`}
              />
            </div>
          </div>

          <p id={`appt-zone-${step.id}`} className="app-hint">
            {deviceTimeZone
              ? `Enter the time as it is in ${timeZoneLabel(deviceTimeZone)} (this device's time zone). It is saved with that time zone.`
              : "Enter the time as it is where this device is. The time zone is saved with it."}{" "}
            Your name and the time you saved are recorded in the timeline.
          </p>

          {usingQuoteSuggestion && (
            <div className="grid gap-2 rounded border-2 border-amber-500 bg-amber-50 p-3">
              <p id={`appt-suggested-${step.id}`}>
                <span className="font-semibold">Needs attention: date and time filled in from the note.</span>{" "}
                The note does not say which time zone. Check them before saving.
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={zoneConfirmed}
                  onChange={(e) => setZoneConfirmed(e.target.checked)}
                  disabled={isPending || !deviceTimeZone}
                  aria-describedby={`appt-suggested-${step.id}`}
                  className="mt-1 h-5 w-5"
                />
                <span>
                  {deviceTimeZone
                    ? (() => {
                        const instant = zonedTimeToInstant(appointmentDate, appointmentTime, deviceTimeZone);
                        const shown = instant.ok
                          ? formatDateTimeInZone(instant.instant, deviceTimeZone)
                          : `${appointmentDate} ${appointmentTime}`;
                        return `I confirm the appointment is ${shown}, ${timeZoneLabel(deviceTimeZone)} time.`;
                      })()
                    : "Reading this device's time zone…"}
                </span>
              </label>
            </div>
          )}
          <button
            type="button"
            onClick={handleSaveAppointment}
            disabled={isPending}
            className="app-button"
          >
            {isPending ? "Saving…" : "Save appointment details"}
          </button>
        </fieldset>
      )}

      {/* Assign owner */}
      <div className="grid gap-2">
        <label htmlFor={`owner-${step.id}`} className="app-label">
          Responsible person
        </label>
        <select
          id={`owner-${step.id}`}
          value={selectedOwner}
          onChange={(e) => setSelectedOwner(e.target.value)}
          className="app-input"
          disabled={isPending}
          aria-describedby={`owner-hint-${step.id}`}
        >
          <option value="">— Not assigned —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName} ({m.role.replace(/_/g, " ")})
            </option>
          ))}
        </select>
        <p id={`owner-hint-${step.id}`} className="app-hint">
          Who is responsible for making sure this step is done?
        </p>
      </div>

      <div className="grid gap-2">
        <label htmlFor={`backup-${step.id}`} className="app-label">
          Backup person <span className="app-hint font-normal">(optional)</span>
        </label>
        <select
          id={`backup-${step.id}`}
          value={selectedBackup}
          onChange={(e) => setSelectedBackup(e.target.value)}
          className="app-input"
          disabled={isPending}
        >
          <option value="">— None —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleAssign}
          disabled={isPending}
          className="app-button"
        >
          {isPending ? "Saving…" : "Save responsibility"}
        </button>

        {isAwaitingApproval(step) && (
          <button
            type="button"
            onClick={handleApprove}
            disabled={isPending}
            className="app-button"
            aria-describedby={`approve-hint-${step.id}`}
          >
            {isPending ? "Saving…" : "Confirm this step"}
          </button>
        )}

        {canOfferCompletion(step) && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={isPending}
            className="app-button app-button--quiet"
          >
            {isPending ? "Saving…" : "Mark as done"}
          </button>
        )}
      </div>

      {isAwaitingApproval(step) && (
        <p id={`approve-hint-${step.id}`} className="app-hint">
          By clicking &ldquo;Confirm this step&rdquo; you are taking personal responsibility for
          authorising this action. This is recorded in the audit trail.
        </p>
      )}

      {/* Evidence text upload (Phase 8) */}
      {(step.status === "completed" || canOfferCompletion(step)) && (
        <div className="grid gap-2 border-t pt-4">
          <label htmlFor={`evidence-${step.id}`} className="app-label">
            Add evidence <span className="app-hint font-normal">(optional)</span>
          </label>
          <textarea
            id={`evidence-${step.id}`}
            value={evidenceText}
            onChange={(e) => setEvidenceText(e.target.value)}
            className="app-input min-h-[5rem]"
            disabled={isPending}
            placeholder="Describe what was done, or paste a confirmation reference…"
            maxLength={2000}
            aria-describedby={`evidence-hint-${step.id}`}
          />
          <p id={`evidence-hint-${step.id}`} className="app-hint">
            This is saved with this step as evidence. The audit trail records that evidence was added, not what it says.
          </p>
          <button
            type="button"
            onClick={() => {
              if (!evidenceText.trim()) return;
              clearMessages();
              startTransition(async () => {
                const result = await addTextEvidence({ stepId: step.id, text: evidenceText.trim() });
                if (result.ok) {
                  setSuccess(result.message ?? "Evidence saved with this step.");
                  setEvidenceText("");
                } else {
                  setError(result.error);
                }
              });
            }}
            disabled={isPending || !evidenceText.trim()}
            className="app-button app-button--quiet"
          >
            {isPending ? "Saving…" : "Save evidence"}
          </button>
        </div>
      )}
    </div>
  );
}
