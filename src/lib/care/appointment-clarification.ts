import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { SessionUser } from "@/lib/auth/session";
import { errorCode, type Logger } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

import {
  APPOINTMENT_LOCATION_MAX,
  APPOINTMENT_MESSAGES,
  appointmentClarificationInput,
  wallClockInZone,
} from "./appointment";

type Client = SupabaseClient<Database>;

/**
 * Server side of "Save appointment details" on an appointment step.
 *
 * The service validates the input (an ISO instant with an offset, a known
 * IANA time zone, and a match between that instant and the date and time the
 * person typed), then asks the store to save. The Supabase store calls
 * public.save_appointment_clarification, which checks active membership and
 * writes the step fields and the audit event in one transaction.
 */

export type SaveRefusal = "step_not_found" | "not_allowed" | "not_appointment" | "invalid_input" | "error";

export interface AppointmentClarificationStore {
  save(input: {
    stepId: string;
    userId: string;
    location: string;
    appointmentAt: string;
    timeZone: string;
  }): Promise<{ ok: true; careChainId: string; auditEventId: string; noteId?: string } | { ok: false; code: SaveRefusal }>;
}

export type SaveAppointmentResult = { ok: true; careChainId: string } | { ok: false; error: string };

const SIGNED_OUT = "You must be signed in.";

const REFUSAL_MESSAGES: Record<SaveRefusal, string> = {
  // Same message for both, so nobody learns whether another household's step exists.
  step_not_found: "This step could not be found, or you do not have access to it. Please reload the page.",
  not_allowed: "This step could not be found, or you do not have access to it. Please reload the page.",
  not_appointment: "Appointment details can only be added to appointment steps.",
  invalid_input: "Please check the hospital or clinic name, date, and time, then try again.",
  error: "Could not save appointment details. Please try again.",
};

function messageForInputProblem(field: PropertyKey | undefined): string {
  switch (field) {
    case "location":
      return `Please add the hospital or clinic name (up to ${APPOINTMENT_LOCATION_MAX} characters).`;
    case "localDate":
      return "Please add the appointment date.";
    case "localTime":
      return "Please add the appointment time.";
    case "appointmentAt":
      return "The appointment time was sent without a time zone, so it was not saved. Please reload the page and try again.";
    case "timeZone":
      return APPOINTMENT_MESSAGES.zoneUnknown;
    default:
      return "This step could not be found. Please reload the page.";
  }
}

export function createAppointmentClarificationService(deps: {
  store: AppointmentClarificationStore;
  log: Logger;
}) {
  const { store, log } = deps;

  return {
    async save(user: SessionUser | null, input: unknown): Promise<SaveAppointmentResult> {
      if (!user) return { ok: false, error: SIGNED_OUT };

      const parsed = appointmentClarificationInput.safeParse(input);
      if (!parsed.success) {
        return { ok: false, error: messageForInputProblem(parsed.error.issues[0]?.path[0]) };
      }
      const { stepId, location, appointmentAt, timeZone, localDate, localTime } = parsed.data;

      // The instant must show exactly what the person typed, in the zone they were told.
      const shown = wallClockInZone(new Date(appointmentAt), timeZone);
      if (shown.date !== localDate || shown.time !== localTime) {
        return {
          ok: false,
          error:
            "The appointment time did not match your time zone, so it was not saved. Please check the date and time and try again.",
        };
      }

      const saved = await store.save({
        stepId,
        userId: user.id,
        location,
        appointmentAt: new Date(appointmentAt).toISOString(),
        timeZone,
      });

      if (!saved.ok) {
        if (saved.code === "error" || saved.code === "invalid_input") {
          log("error", "care.appointment_clarification_failed", { stage: "save", code: saved.code });
        }
        return { ok: false, error: REFUSAL_MESSAGES[saved.code] };
      }

      log("info", "care.appointment_clarified", { user_id: user.id });
      return { ok: true, careChainId: saved.careChainId };
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase store
// ---------------------------------------------------------------------------

const KNOWN_REFUSALS = new Set<SaveRefusal>(["step_not_found", "not_allowed", "not_appointment", "invalid_input"]);

const rpcResult = z.object({ audit_event_id: z.uuid(), care_chain_id: z.uuid(), note_id: z.uuid().optional() });

/** `admin` must be the service-role client; the SQL function is not callable by browser roles. */
export function createSupabaseAppointmentClarificationStore(admin: Client, log: Logger): AppointmentClarificationStore {
  return {
    async save({ stepId, userId, location, appointmentAt, timeZone }) {
      const { data, error } = await admin.rpc("save_appointment_clarification", {
        p_step_id: stepId,
        p_user_id: userId,
        p_location: location,
        p_appointment_time: appointmentAt,
        p_timezone: timeZone,
      });
      if (error) {
        const code = error.message as SaveRefusal;
        if (KNOWN_REFUSALS.has(code)) return { ok: false, code };
        log("error", "care.appointment_clarification_rpc_failed", { code: errorCode(error) });
        return { ok: false, code: "error" };
      }
      const parsed = rpcResult.safeParse(data);
      if (!parsed.success) {
        log("error", "care.appointment_clarification_rpc_failed", { code: "unexpected_result" });
        return { ok: false, code: "error" };
      }
      return {
        ok: true,
        careChainId: parsed.data.care_chain_id,
        auditEventId: parsed.data.audit_event_id,
        ...(parsed.data.note_id !== undefined && { noteId: parsed.data.note_id }),
      };
    },
  };
}
