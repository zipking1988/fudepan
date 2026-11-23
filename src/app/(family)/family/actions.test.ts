import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, getFamilyContext, revalidatePath, rpc, from, retryNote } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getFamilyContext: vi.fn(),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  retryNote: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/family/session", () => ({ getFamilyContext }));
// The admin client has no `from`: any direct table write would throw.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, storage: {} }) }));
vi.mock("@/app/(app)/notes/actions", () => ({ retryRecognition: retryNote }));

import {
  claimPart,
  completePart,
  confirmPartTime,
  decideApproval,
  markFeedSeen,
  releasePart,
  reopenPart,
  reportPartFailed,
  requestAssignment,
  requestBackup,
  requestHandover,
  respondToRequest,
  resolveMissingDetail,
  resubmitPart,
  retryRecognition,
  saveAppointmentDetails,
  savePartAmount,
  sendRecipientReply,
  setLanguage,
  volunteerBackup,
  addTextEvidence,
} from "./actions";

const U = (n: number) => `d${n}000000-0000-4000-8000-000000000001`;
const STEP = U(3);
const NOTE = U(4);
const CHAIN = U(5);
const USER = { id: U(1) };

function outcome(extra: Record<string, unknown> = {}) {
  return { data: { care_chain_id: CHAIN, note_id: NOTE, outcome: "ok", ...extra }, error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: USER, supabase: { from } });
  rpc.mockResolvedValue(outcome());
});

const paths = ["/family", `/family/events/${NOTE}`, `/family/events/${NOTE}/timeline`];

const cases: [string, (i: unknown) => Promise<unknown>, string, Record<string, unknown>][] = [
  ["claimPart", claimPart, "claim_part", { stepId: STEP, role: "owner" }],
  ["releasePart", releasePart, "release_part", { stepId: STEP, role: "driver" }],
  ["requestAssignment", requestAssignment, "request_assignment", { stepId: STEP, toMemberId: U(6) }],
  ["requestHandover", requestHandover, "request_handover", { stepId: STEP, role: "owner", toMemberId: U(6) }],
  ["requestBackup", requestBackup, "request_backup", { stepId: STEP, toMemberId: U(6) }],
  ["volunteerBackup", volunteerBackup, "volunteer_backup", { stepId: STEP }],
  ["respondToRequest", respondToRequest, "respond_to_request", { requestId: U(7), accept: true }],
  ["decideApproval", decideApproval, "decide_approval", { stepId: STEP, decision: "approve" }],
  ["resubmitPart", resubmitPart, "resubmit_part", { stepId: STEP, explanation: "Done" }],
  ["completePart", completePart, "complete_part", { stepId: STEP }],
  ["reportPartFailed", reportPartFailed, "report_part_failed", { stepId: STEP }],
  ["reopenPart", reopenPart, "reopen_part", { stepId: STEP }],
  ["savePartAmount", savePartAmount, "save_part_amount", { stepId: STEP, amountMinor: 1200, currency: "JPY" }],
  ["resolveMissingDetail", resolveMissingDetail, "resolve_missing_detail", { detailId: U(8), answer: "Tuesday" }],
];

describe.each(cases)("%s", (_name, action, fn, input) => {
  it("calls the SQL function as the signed-in person and revalidates event, feed, timeline", async () => {
    expect(await action(input)).toMatchObject({ ok: true, outcome: "ok" });
    expect(rpc).toHaveBeenCalledWith(fn, expect.objectContaining({ p_user_id: USER.id }));
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses a signed-out person without calling the database", async () => {
    getSession.mockResolvedValue({ user: null, supabase: { from } });
    expect(await action(input)).toEqual({ ok: false, messageKey: "refusal.signedOut", params: {} });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a refusal to a message key and does not revalidate", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_holder" } });
    const result = await action(input);
    expect(result).toEqual({ ok: false, messageKey: "refusal.notHolder", params: {} });
    expect(JSON.stringify(result)).not.toContain("not_holder");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("outcomes", () => {
  it("returns a message key for evidence_required with the missing labels", async () => {
    rpc.mockResolvedValue(outcome({ outcome: "evidence_required", missing: ["Receipt"] }));
    expect(await completePart({ stepId: STEP })).toEqual({
      ok: true,
      outcome: "evidence_required",
      messageKey: "outcome.evidenceRequired",
      missing: ["Receipt"],
    });
  });

  it("points at the failing field for invalid input", async () => {
    expect(await claimPart({ stepId: "nope", role: "owner" })).toEqual({
      ok: false,
      messageKey: "refusal.invalidInput",
      params: { field: "stepId" },
    });
  });
});

describe("confirmPartTime", () => {
  it("converts local date, time, and zone to one instant", async () => {
    await confirmPartTime({
      stepId: STEP,
      kind: "task_due",
      localDate: "2026-12-05",
      localTime: "10:00",
      timeZone: "Asia/Tokyo",
    });
    expect(rpc).toHaveBeenCalledWith(
      "confirm_part_time",
      expect.objectContaining({
        p_kind: "task_due",
        p_at: "2026-12-05T01:00:00.000Z",
        p_timezone: "Asia/Tokyo",
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/family/events/${NOTE}`);
  });

  it("refuses a time that does not exist", async () => {
    expect(
      await confirmPartTime({
        stepId: STEP,
        kind: "respond_by",
        localDate: "2026-03-08",
        localTime: "02:30",
        timeZone: "America/New_York",
      }),
    ).toEqual({ ok: false, messageKey: "refusal.invalidInput", params: { field: "localTime" } });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("markFeedSeen", () => {
  it("calls the function and revalidates the feed", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await markFeedSeen({ householdId: U(2) })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("mark_feed_seen", expect.objectContaining({ p_user_id: USER.id }));
    expect(revalidatePath).toHaveBeenCalledWith("/family");
  });
});

describe("setLanguage", () => {
  const HOUSEHOLD = U(2);
  beforeEach(() => {
    getFamilyContext.mockResolvedValue({
      user: USER,
      result: { kind: "ok", context: { householdId: HOUSEHOLD, memberId: U(9), role: "care_recipient" } },
    });
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it("saves for the household from the member's context and revalidates the feed and settings page", async () => {
    expect(await setLanguage({ language: "ja" })).toEqual({ ok: true });
    expect(getFamilyContext).toHaveBeenCalledWith(undefined);
    expect(rpc).toHaveBeenCalledWith(
      "set_member_language",
      expect.objectContaining({ p_household_id: HOUSEHOLD, p_user_id: USER.id, p_language: "ja" }),
    );
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(["/family", "/family/settings/language"]);
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses an unknown language without calling the database", async () => {
    expect(await setLanguage({ language: "fr" })).toEqual({
      ok: false,
      messageKey: "refusal.invalidInput",
      params: { field: "language" },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a household the person does not belong to", async () => {
    getFamilyContext.mockResolvedValue({ user: USER, result: { kind: "not_member" } });
    expect(await setLanguage({ householdId: U(7), language: "en" })).toEqual({
      ok: false,
      messageKey: "refusal.notFoundOrNoAccess",
      params: {},
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a signed-out person", async () => {
    getSession.mockResolvedValue({ user: null, supabase: { from } });
    expect(await setLanguage({ language: "en" })).toEqual({ ok: false, messageKey: "refusal.signedOut", params: {} });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a database refusal to a key and does not revalidate", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await setLanguage({ language: "en" })).toMatchObject({ ok: false, messageKey: "refusal.error" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("addTextEvidence", () => {
  it("records text through record_evidence only", async () => {
    await addTextEvidence({ stepId: STEP, label: "Note", text: "Paid at the counter" });
    expect(rpc).toHaveBeenCalledWith(
      "record_evidence",
      expect.objectContaining({ p_kind: "text", p_text: "Paid at the counter" }),
    );
    expect(from).not.toHaveBeenCalled();
  });
});

describe("retryRecognition", () => {
  it("reuses the note retry and revalidates the event", async () => {
    retryNote.mockResolvedValue({ ok: true });
    expect(await retryRecognition(NOTE)).toEqual({ ok: true });
    expect(retryNote).toHaveBeenCalledWith(NOTE);
    expect(revalidatePath).toHaveBeenCalledWith(`/family/events/${NOTE}`);
  });

  it("maps a refusal to a message key and refuses a signed-out person", async () => {
    retryNote.mockResolvedValue({ ok: false, error: "English text" });
    expect(await retryRecognition(NOTE)).toEqual({
      ok: false,
      messageKey: "refusal.notFoundOrNoAccess",
      params: {},
    });
    getSession.mockResolvedValue({ user: null, supabase: { from } });
    expect(await retryRecognition(NOTE)).toMatchObject({ messageKey: "refusal.signedOut" });
  });
});

describe("saveAppointmentDetails", () => {
  const input = { stepId: STEP, location: " City Clinic ", localDate: "2026-12-05", localTime: "10:00", timeZone: "Asia/Tokyo" };
  const saved = { data: { audit_event_id: U(9), care_chain_id: CHAIN, note_id: NOTE }, error: null };

  it("converts local time and zone to one instant, calls the SQL function, and revalidates event, feed, timeline", async () => {
    rpc.mockResolvedValue(saved);
    expect(await saveAppointmentDetails(input)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("save_appointment_clarification", {
      p_step_id: STEP,
      p_user_id: USER.id,
      p_location: "City Clinic",
      p_appointment_time: "2026-12-05T01:00:00.000Z",
      p_timezone: "Asia/Tokyo",
    });
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual(paths);
    expect(from).not.toHaveBeenCalled();
  });

  it("returns keys for a refusal and does not revalidate", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "not_allowed" } });
    const result = await saveAppointmentDetails(input);
    expect(result).toEqual({ ok: false, messageKey: "refusal.notFoundOrNoAccess", params: {} });
    expect(JSON.stringify(result)).not.toContain("not_allowed");
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await saveAppointmentDetails(input)).toEqual({ ok: false, messageKey: "refusal.error", params: {} });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("points at the field for a missing clinic, a nonexistent time, or an unknown zone", async () => {
    expect(await saveAppointmentDetails({ ...input, location: "  " })).toEqual({
      ok: false,
      messageKey: "refusal.invalidInput",
      params: { field: "location" },
    });
    expect(
      await saveAppointmentDetails({ ...input, localDate: "2026-03-08", localTime: "02:30", timeZone: "America/New_York" }),
    ).toMatchObject({ messageKey: "refusal.invalidInput", params: { field: "localTime" } });
    expect(await saveAppointmentDetails({ ...input, timeZone: "Mars/Base" })).toMatchObject({
      params: { field: "timeZone" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a signed-out person without calling the database", async () => {
    getSession.mockResolvedValue({ user: null, supabase: { from } });
    expect(await saveAppointmentDetails(input)).toEqual({ ok: false, messageKey: "refusal.signedOut", params: {} });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("sendRecipientReply", () => {
  it("sends one of the two fixed replies and revalidates the family views", async () => {
    rpc.mockResolvedValue({ data: { outcome: "sent", note_id: NOTE, audit_event_id: U(9) }, error: null });
    const result = await sendRecipientReply({ noteId: NOTE, reply: "question" });
    expect(result).toEqual({ ok: true, outcome: "sent", messageKey: "recipient.reply.sent" });
    expect(rpc).toHaveBeenCalledWith("send_recipient_reply", { p_note_id: NOTE, p_user_id: USER.id, p_reply: "question" });
    for (const path of [...paths, `/family/me/${NOTE}`]) expect(revalidatePath).toHaveBeenCalledWith(path);
  });

  it("tells her when the family already has the same message", async () => {
    rpc.mockResolvedValue({ data: { outcome: "already_sent", note_id: NOTE, audit_event_id: null }, error: null });
    expect(await sendRecipientReply({ noteId: NOTE, reply: "thanks" })).toMatchObject({
      ok: true,
      messageKey: "recipient.reply.alreadySent",
    });
  });

  it("refuses free text without calling the database", async () => {
    const result = await sendRecipientReply({ noteId: NOTE, reply: "Please bring soup" });
    expect(result).toMatchObject({ ok: false, messageKey: "refusal.invalidInput" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps 'only the recipient can reply' to a plain key and does not revalidate", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "recipient_only", code: "P0001" } });
    expect(await sendRecipientReply({ noteId: NOTE, reply: "thanks" })).toMatchObject({
      ok: false,
      messageKey: "refusal.recipientOnly",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a signed-out person", async () => {
    getSession.mockResolvedValue({ user: null, supabase: { from } });
    expect(await sendRecipientReply({ noteId: NOTE, reply: "thanks" })).toMatchObject({ ok: false, messageKey: "refusal.signedOut" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
