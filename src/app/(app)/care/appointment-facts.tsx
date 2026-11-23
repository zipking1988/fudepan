import { LocalDateTime } from "@/components/app/local-date-time";
import { isValidTimeZone, parseAppointmentClarifiedPayload, timeZoneLabel } from "@/lib/care/appointment";
import { formatDateTimeInZone } from "@/lib/format-date";

/**
 * The appointment time in the zone it was entered in, with that zone written
 * out, so "10:00 AM" means the same thing to every family member.
 */
export function AppointmentTime({ iso, timeZone }: { iso: string; timeZone: string | null }) {
  if (!timeZone || !isValidTimeZone(timeZone)) return <LocalDateTime iso={iso} />;
  return (
    <>
      <time dateTime={iso}>{formatDateTimeInZone(new Date(iso), timeZone)}</time>{" "}
      <span className="app-hint">({timeZoneLabel(timeZone)} time)</span>
    </>
  );
}

/** Rows for the step card's fact list. Renders nothing for missing values. */
export function AppointmentStepFacts({
  location,
  appointmentTime,
  appointmentTimezone,
}: {
  location: string | null;
  appointmentTime: string | null;
  appointmentTimezone: string | null;
}) {
  return (
    <>
      {location && (
        <>
          <dt>Hospital or clinic</dt>
          <dd className="font-semibold">{location}</dd>
        </>
      )}
      {appointmentTime && (
        <>
          <dt>Appointment time</dt>
          <dd className="font-semibold">
            <AppointmentTime iso={appointmentTime} timeZone={appointmentTimezone} />
          </dd>
        </>
      )}
    </>
  );
}

/** Rows for an `appointment_clarified` timeline event. */
export function AppointmentClarifiedFacts({
  payload,
  actorName,
}: {
  payload: Record<string, unknown>;
  actorName: string | null;
}) {
  const details = parseAppointmentClarifiedPayload(payload);
  if (!details) {
    return (
      <>
        <dt>Details</dt>
        <dd>The saved appointment details could not be shown. Open the step to see the current details.</dd>
      </>
    );
  }
  const previous = details.previous;
  return (
    <>
      <dt>Hospital or clinic</dt>
      <dd>{details.location}</dd>
      <dt>Appointment time</dt>
      <dd>
        <AppointmentTime iso={details.appointment_time} timeZone={details.timezone} />
      </dd>
      <dt>Supplied by</dt>
      <dd>{actorName ?? "A household member"}</dd>
      {previous && (
        <>
          <dt>Replaced</dt>
          <dd>
            {previous.location ?? "No hospital or clinic"}
            {previous.appointment_time && (
              <>
                {", "}
                <AppointmentTime iso={previous.appointment_time} timeZone={previous.timezone} />
              </>
            )}
          </dd>
        </>
      )}
    </>
  );
}
