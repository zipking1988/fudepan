import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveAppointmentClarification } from "@/app/(app)/care/actions";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

import { buildAppointmentClarificationInput, isValidTimeZone } from "./appointment";
import { parseAppointmentQuote } from "./appointment-quote";

/**
 * Tests for the real `saveAppointmentClarification` server action, called the
 * way the appointment step card calls it. Only the edges are replaced:
 * the session, the service-role client (an in-memory database whose
 * `save_appointment_clarification` follows the SQL function's rules), and
 * Next.js cache revalidation. The SQL function itself is covered by
 * supabase/tests/database/appointment_clarification.test.sql. All data is fake.
 */

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const OTHER_HOUSEHOLD = "e0000000-0000-4000-8000-000000000001";
const CHAIN = "a2000000-0000-4000-8000-000000000001";
const APPOINTMENT_STEP = "a3000000-0000-4000-8000-000000000001";
const DOCUMENT_STEP = "a3000000-0000-4000-8000-000000000002";
const MISA = "d1000000-0000-4000-8000-000000000002";
const MISA_MEMBER = "d2000000-0000-4000-8000-000000000002";
const KENTA_INACTIVE = "d1000000-0000-4000-8000-000000000003";
const OUTSIDER = "e1000000-0000-4000-8000-000000000001";

type StepRow = {
  careChainId: string;
  careCategory: string;
  status: string;
  approvalRequired: boolean;
  dueAt: string | null;
  escalationAt: string | null;
  sourceQuote: string | null;
  appointmentLocation: string | null;
  appointmentTime: string | null;
  appointmentTimezone: string | null;
};

type AuditRow = {
  householdId: string;
  careChainId: string;
  careStepId: string;
  actorType: string;
  actorId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

/** Mirrors public.save_appointment_clarification: one call = step update + one audit row, or nothing. */
class FakeDb {
  chains = new Map([[CHAIN, HOUSEHOLD]]);
  members = [
    { householdId: HOUSEHOLD, userId: MISA, memberId: MISA_MEMBER, active: true },
    { householdId: HOUSEHOLD, userId: KENTA_INACTIVE, memberId: "d2000000-0000-4000-8000-000000000003", active: false },
    { householdId: OTHER_HOUSEHOLD, userId: OUTSIDER, memberId: "e2000000-0000-4000-8000-000000000001", active: true },
  ];
  steps = new Map<string, StepRow>([
    [
      APPOINTMENT_STEP,
      {
        careChainId: CHAIN,
        careCategory: "appointment",
        status: "pending_review",
        approvalRequired: true,
        dueAt: "2026-12-01T09:00:00Z",
        escalationAt: "2026-12-02T09:00:00Z",
        sourceQuote: "Hospital next Friday?",
        appointmentLocation: null,
        appointmentTime: null,
        appointmentTimezone: null,
      },
    ],
    [
      DOCUMENT_STEP,
      {
        careChainId: CHAIN,
        careCategory: "document",
        status: "pending_review",
        approvalRequired: false,
        dueAt: null,
        escalationAt: null,
        sourceQuote: "Paperwork",
        appointmentLocation: null,
        appointmentTime: null,
        appointmentTimezone: null,
      },
    ],
  ]);
  audits: AuditRow[] = [];
  rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  /** Simulates a database outage. */
  broken = false;

  async rpc(name: string, args: Record<string, string>) {
    this.rpcCalls.push({ name, args });
    const fail = (message: string) => ({ data: null, error: { message, code: "P0001" } });
    if (this.broken) return { data: null, error: { message: "connection refused", code: "08006" } };
    if (name !== "save_appointment_clarification") return fail("unknown_function");

    const step = this.steps.get(args.p_step_id);
    if (!step) return fail("step_not_found");
    const householdId = this.chains.get(step.careChainId)!;
    const member = this.members.find((m) => m.householdId === householdId && m.userId === args.p_user_id && m.active);
    if (!member) return fail("not_allowed");
    if (step.careCategory !== "appointment") return fail("not_appointment");
    const location = args.p_location?.trim() ?? "";
    const instant = new Date(args.p_appointment_time);
    if (!location || location.length > 200 || Number.isNaN(instant.getTime()) || !isValidTimeZone(args.p_timezone)) {
      return fail("invalid_input");
    }

    step.appointmentLocation = location;
    step.appointmentTime = instant.toISOString();
    step.appointmentTimezone = args.p_timezone;
    const auditId = crypto.randomUUID();
    this.audits.push({
      householdId,
      careChainId: step.careChainId,
      careStepId: args.p_step_id,
      actorType: "human",
      actorId: args.p_user_id,
      eventType: "appointment_clarified",
      payload: {
        location,
        appointment_time: instant.toISOString().replace(".000Z", "Z"),
        timezone: args.p_timezone,
        clarified_by: args.p_user_id,
        clarified_by_member_id: member.memberId,
        previous: null,
      },
    });
    return { data: { audit_event_id: auditId, care_chain_id: step.careChainId }, error: null };
  }

  from(): never {
    throw new Error("The action must not write tables directly; it must use the atomic function.");
  }
}

let db: FakeDb;

function signInAs(userId: string | null) {
  vi.mocked(getSession).mockResolvedValue({
    supabase: {} as never,
    user: userId ? { id: userId } : null,
  });
}

/** Exactly what the card sends for a person typing into the form on a device in `timeZone`. */
function cardInput(overrides: Partial<{ location: string; localDate: string; localTime: string; timeZone: string }> = {}) {
  const built = buildAppointmentClarificationInput({
    stepId: APPOINTMENT_STEP,
    location: "Fake Clinic",
    localDate: "2026-12-05",
    localTime: "10:00",
    timeZone: "Asia/Tokyo",
    ...overrides,
  });
  if (!built.ok) throw new Error(`card refused input: ${built.error}`);
  return built.input;
}

let consoleError: { mock: { calls: unknown[][] } };

beforeEach(() => {
  db = new FakeDb();
  vi.mocked(createAdminClient).mockReturnValue(db as never);
  vi.mocked(revalidatePath).mockClear();
  signInAs(MISA);
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveAppointmentClarification: saving from the step card", () => {
  it("accepts the card's input and stores the exact instant with its time zone", async () => {
    const input = cardInput();
    expect(input.appointmentAt).toBe("2026-12-05T01:00:00.000Z");

    await expect(saveAppointmentClarification(input)).resolves.toEqual({ ok: true });

    expect(db.rpcCalls).toEqual([
      {
        name: "save_appointment_clarification",
        args: {
          p_step_id: APPOINTMENT_STEP,
          p_user_id: MISA,
          p_location: "Fake Clinic",
          p_appointment_time: "2026-12-05T01:00:00.000Z",
          p_timezone: "Asia/Tokyo",
        },
      },
    ]);
    const step = db.steps.get(APPOINTMENT_STEP)!;
    expect(step).toMatchObject({
      appointmentLocation: "Fake Clinic",
      appointmentTime: "2026-12-05T01:00:00.000Z",
      appointmentTimezone: "Asia/Tokyo",
    });
  });

  it("records one appointment_clarified event attributed to the signed-in person", async () => {
    await saveAppointmentClarification(cardInput());

    expect(db.audits).toHaveLength(1);
    expect(db.audits[0]).toMatchObject({
      householdId: HOUSEHOLD,
      careChainId: CHAIN,
      careStepId: APPOINTMENT_STEP,
      actorType: "human",
      actorId: MISA,
      eventType: "appointment_clarified",
      payload: { location: "Fake Clinic", timezone: "Asia/Tokyo", clarified_by: MISA },
    });
  });

  it("leaves the family deadline, escalation time, approval gate, and note quote unchanged", async () => {
    const before = { ...db.steps.get(APPOINTMENT_STEP)! };
    await saveAppointmentClarification(cardInput());
    const after = db.steps.get(APPOINTMENT_STEP)!;

    expect(after.dueAt).toBe(before.dueAt);
    expect(after.escalationAt).toBe(before.escalationAt);
    expect(after.status).toBe("pending_review");
    expect(after.approvalRequired).toBe(true);
    expect(after.sourceQuote).toBe("Hospital next Friday?");
    expect(after.appointmentTime).not.toBe(after.dueAt);
  });

  it("refreshes the step card and the timeline", async () => {
    await saveAppointmentClarification(cardInput());
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([[`/care/${CHAIN}`], [`/care/${CHAIN}/timeline`]]);
  });

  it("converts a time typed in another zone to the right instant", async () => {
    const input = cardInput({ timeZone: "America/New_York" });
    expect(input.appointmentAt).toBe("2026-12-05T15:00:00.000Z");
    await expect(saveAppointmentClarification(input)).resolves.toEqual({ ok: true });
    expect(db.steps.get(APPOINTMENT_STEP)!.appointmentTimezone).toBe("America/New_York");
  });
});

describe("saveAppointmentClarification: server-side time validation", () => {
  it("refuses the previous card payload (date/time without an offset)", async () => {
    const result = await saveAppointmentClarification({
      stepId: APPOINTMENT_STEP,
      location: "Fake Clinic",
      appointmentTime: "2026-12-05T10:00:00",
      timezone: "+09:00",
    });
    expect(result.ok).toBe(false);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("refuses an ISO date/time that has no offset", async () => {
    const result = await saveAppointmentClarification({ ...cardInput(), appointmentAt: "2026-12-05T10:00:00" });
    expect(result).toEqual({
      ok: false,
      error:
        "The appointment time was sent without a time zone, so it was not saved. Please reload the page and try again.",
    });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("refuses a raw offset instead of a named time zone", async () => {
    const result = await saveAppointmentClarification({ ...cardInput(), timeZone: "+09:00" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("time zone could not be read");
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("refuses an instant that does not show the typed time in the stated zone", async () => {
    // 10:00 Tokyo sent with the offset sign flipped (a classic client bug).
    const result = await saveAppointmentClarification({
      ...cardInput(),
      appointmentAt: "2026-12-05T10:00:00-09:00",
    });
    expect(result).toEqual({
      ok: false,
      error:
        "The appointment time did not match your time zone, so it was not saved. Please check the date and time and try again.",
    });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("accepts an equivalent instant written with an offset", async () => {
    const result = await saveAppointmentClarification({ ...cardInput(), appointmentAt: "2026-12-05T10:00:00+09:00" });
    expect(result).toEqual({ ok: true });
    expect(db.rpcCalls[0].args.p_appointment_time).toBe("2026-12-05T01:00:00.000Z");
  });

  it("names the missing field when the hospital or clinic is blank", async () => {
    const result = await saveAppointmentClarification({ ...cardInput(), location: "   " });
    expect(result).toEqual({
      ok: false,
      error: "Please add the hospital or clinic name (up to 200 characters).",
    });
    expect(db.rpcCalls).toHaveLength(0);
  });
});

describe("saveAppointmentClarification: who may save", () => {
  it("requires a signed-in person and writes nothing otherwise", async () => {
    signInAs(null);
    await expect(saveAppointmentClarification(cardInput())).resolves.toEqual({
      ok: false,
      error: "You must be signed in.",
    });
    expect(db.rpcCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a member of another household without revealing the step", async () => {
    signInAs(OUTSIDER);
    const result = await saveAppointmentClarification(cardInput());
    expect(result).toEqual({
      ok: false,
      error: "This step could not be found, or you do not have access to it. Please reload the page.",
    });
    expect(db.audits).toHaveLength(0);
    expect(db.steps.get(APPOINTMENT_STEP)!.appointmentLocation).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses an inactive member", async () => {
    signInAs(KENTA_INACTIVE);
    const result = await saveAppointmentClarification(cardInput());
    expect(result.ok).toBe(false);
    expect(db.audits).toHaveLength(0);
  });

  it("refuses steps that are not appointments", async () => {
    const result = await saveAppointmentClarification({ ...cardInput(), stepId: DOCUMENT_STEP });
    expect(result).toEqual({ ok: false, error: "Appointment details can only be added to appointment steps." });
    expect(db.steps.get(DOCUMENT_STEP)!.appointmentLocation).toBeNull();
    expect(db.audits).toHaveLength(0);
  });

  it("shows a plain retry message on a database failure and keeps the location out of logs", async () => {
    db.broken = true;
    const result = await saveAppointmentClarification(cardInput({ location: "Fake Heart Clinic" }));
    expect(result).toEqual({ ok: false, error: "Could not save appointment details. Please try again." });
    const logged = consoleError.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("care.appointment_clarification_rpc_failed");
    expect(logged).not.toContain("Fake Heart Clinic");
    expect(logged).not.toContain("connection refused");
  });
});

describe("saveAppointmentClarification: Alpha QA note (prefilled from the quote)", () => {
  it("saves the clinic with the note's 2:30 pm confirmed in Asia/Tokyo, as one event, without approving", async () => {
    const step = db.steps.get(APPOINTMENT_STEP)!;
    step.sourceQuote = "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.";
    const suggestion = parseAppointmentQuote(step.sourceQuote)!;

    // The person enters only the clinic; date and time are the confirmed prefill.
    const built = buildAppointmentClarificationInput({
      stepId: APPOINTMENT_STEP,
      location: "Sakura Family Clinic (QA)",
      localDate: suggestion.date,
      localTime: suggestion.time,
      timeZone: "Asia/Tokyo",
    });
    if (!built.ok) throw new Error(built.error);
    expect(built.input.appointmentAt).toBe("2026-11-27T05:30:00.000Z");

    await expect(saveAppointmentClarification(built.input)).resolves.toEqual({ ok: true });

    expect(db.audits).toHaveLength(1);
    expect(db.audits[0].payload).toMatchObject({
      location: "Sakura Family Clinic (QA)",
      appointment_time: "2026-11-27T05:30:00Z",
      timezone: "Asia/Tokyo",
    });
    expect(step).toMatchObject({
      status: "pending_review",
      approvalRequired: true,
      sourceQuote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
      appointmentLocation: "Sakura Family Clinic (QA)",
      appointmentTimezone: "Asia/Tokyo",
    });
  });
});
