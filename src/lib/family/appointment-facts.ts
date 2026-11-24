/**
 * The appointment facts a family member saved on a clinic Part, with who saved them.
 *
 * Pure: reads the Part and Timeline entries already loaded with the viewer's RLS client. Only
 * values a person saved are returned: the place from the clarification form and a
 * `human_confirmed` appointment time. Nothing comes from the note text or the model, so a time the
 * note only suggests is never shown here. Who saved it comes from the `appointment_clarified`
 * audit event's actor, never from its payload.
 */
import type { TimelineEntry } from "@/lib/care/timeline";
import type { EventPart, EventTime } from "./shared-care-event";

export type SavedAppointmentFacts = {
  place: string | null;
  time: EventTime | null;
  /** The newest save of these details, or null when the Timeline does not show one. */
  savedBy: { name: string | null; memberId: string | null; at: string } | null;
};

export const APPOINTMENT_SAVED_EVENT = "appointment_clarified";

export function savedAppointmentFacts(
  part: Pick<EventPart, "id" | "careCategory" | "location" | "confirmed">,
  timeline: readonly TimelineEntry[],
): SavedAppointmentFacts | null {
  if (part.careCategory !== "appointment") return null;
  const place = part.location && part.location.trim() !== "" ? part.location.trim() : null;
  const confirmed = part.confirmed.appointment;
  const time = confirmed?.provenance === "human_confirmed" ? confirmed : null;
  if (place === null && time === null) return null;
  let newest: TimelineEntry | null = null;
  for (const e of timeline) {
    if (e.type !== APPOINTMENT_SAVED_EVENT || e.actorType !== "human" || e.stepId !== part.id) continue;
    if (newest === null || Date.parse(e.at) >= Date.parse(newest.at)) newest = e;
  }
  return {
    place,
    time,
    savedBy: newest ? { name: newest.actorName, memberId: newest.actorMemberId ?? null, at: newest.at } : null,
  };
}
