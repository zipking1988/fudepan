import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildTaskIcs,
  escapeIcsText,
  foldIcsLine,
  icsFileName,
  toIcsUtc,
} from "@/lib/calendar/ics";
import { exportTaskToCalendar } from "@/server/api/tasks/calendar";
import { describeAuditEvent } from "@/lib/workflow/timeline";
import type { Membership } from "@/server/session";

const TASK = "33333333-3333-4333-8333-333333333333";
const HH = "22222222-2222-4222-8222-222222222222";
const USER = "11111111-1111-4111-8111-111111111111";
const base = {
  taskId: TASK,
  title: "Pick up test pills",
  categoryLabel: "Medication",
  dueAt: "2030-01-05T15:30:00+09:00",
  location: "Test Pharmacy",
  taskUrl: `https://fudepan.test/tasks/${TASK}`,
  now: new Date("2030-01-01T00:00:00Z"),
};

describe("buildTaskIcs", () => {
  const ics = buildTaskIcs(base);
  const lines = ics.split("\r\n");

  it("is a valid single-event calendar with CRLF line endings", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/\n|\r/);
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain(`UID:${TASK}@fudepan`);
    expect(lines).toContain("STATUS:CONFIRMED");
  });

  it("stores times in UTC with a 30-minute default length and a 1-hour alarm", () => {
    expect(lines).toContain("DTSTART:20300105T063000Z");
    expect(lines).toContain("DTEND:20300105T070000Z");
    expect(lines).toContain("DTSTAMP:20300101T000000Z");
    expect(lines).toContain("TRIGGER:-PT60M");
    expect(buildTaskIcs({ ...base, alarmMinutes: null })).not.toContain("VALARM");
  });

  it("includes title and place but never notes, and states nothing was executed", () => {
    expect(ics).toContain("SUMMARY:Pick up test pills");
    expect(ics).toContain("LOCATION:Test Pharmacy");
    expect(ics.replace(/\r\n /g, "")).toContain(
      "Fudepan has not paid\\, booked\\, or sent anything.",
    );
    expect(buildTaskIcs({ ...base, location: null })).not.toContain("LOCATION:");
  });

  it("masks sensitive values", () => {
    const out = buildTaskIcs({
      ...base,
      title: "Pay with card 4242 4242 4242 4242",
      location: "Account number: 12345678",
    });
    expect(out).not.toMatch(/4242 4242|12345678/);
    expect(out).toContain("[MASKED]");
  });

  it("escapes text and blocks property injection", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const out = buildTaskIcs({ ...base, title: "Buy rice\nATTENDEE:mailto:evil@example.test" });
    expect(out.split("\r\n").some((l) => l.startsWith("ATTENDEE"))).toBe(false);
  });

  it("folds long lines at 75 octets without breaking Japanese characters", () => {
    const long = foldIcsLine(`SUMMARY:${"薬を受け取る".repeat(10)}`);
    for (const part of long.split("\r\n"))
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(
      long
        .split("\r\n")
        .slice(1)
        .every((l) => l.startsWith(" ")),
    ).toBe(true);
    expect(long.replace(/\r\n /g, "")).toBe(`SUMMARY:${"薬を受け取る".repeat(10)}`);
  });

  it("rejects invalid dates and makes safe file names", () => {
    expect(() => buildTaskIcs({ ...base, dueAt: "soon" })).toThrow();
    expect(toIcsUtc(new Date("2030-01-05T06:30:00.123Z"))).toBe("20300105T063000Z");
    expect(icsFileName("Pick up test pills!")).toBe("pick-up-test-pills.ics");
    expect(icsFileName("薬")).toBe("fudepan-task.ics");
    expect(icsFileName('a"b/../c')).toBe("a-b-c.ics");
  });
});

describe("exportTaskToCalendar", () => {
  const member: Membership = {
    memberId: "m",
    householdId: HH,
    householdName: "Test",
    role: "elder",
    displayName: "Test Elder",
  };
  const task = {
    id: TASK,
    household_id: HH,
    note_id: null,
    title: "Pick up test pills",
    category: "medication",
    status: "confirmed",
    due_at: "2030-01-05T06:30:00Z",
    location: null,
  };

  function clients(row: Record<string, unknown> | null, auditError = false) {
    const inserts: Record<string, unknown>[] = [];
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: row }) };
    const supabase = { from: () => q } as unknown as SupabaseClient;
    const admin = {
      from: () => ({
        insert: async (r: Record<string, unknown>) => {
          inserts.push(r);
          return { error: auditError ? { message: "x" } : null };
        },
      }),
    } as unknown as SupabaseClient;
    return { supabase, admin, inserts };
  }
  const run = (c: ReturnType<typeof clients>, memberships = [member]) =>
    exportTaskToCalendar({
      ...c,
      userId: USER,
      memberships,
      taskId: TASK,
      origin: "https://fudepan.test",
    });

  it("exports a confirmed task for any household member and writes a calendar_event_created audit event", async () => {
    const c = clients(task);
    const file = await run(c);
    expect(file.fileName).toBe("pick-up-test-pills.ics");
    expect(file.body).toContain("SUMMARY:Pick up test pills");
    expect(c.inserts).toHaveLength(1);
    expect(c.inserts[0]).toMatchObject({
      task_id: TASK,
      actor_id: USER,
      household_id: HH,
      event_type: "calendar_event_created",
      payload: { method: "ics_download", provider: "none" },
    });
  });

  it("refuses tasks that are not confirmed or have no due date, without writing an audit event", async () => {
    for (const status of ["draft", "awaiting_confirmation", "completed", "cancelled", "rejected"]) {
      const c = clients({ ...task, status });
      await expect(run(c)).rejects.toMatchObject({ code: "not_confirmed" });
      expect(c.inserts).toHaveLength(0);
    }
    const c = clients({ ...task, due_at: null });
    await expect(run(c)).rejects.toMatchObject({ code: "no_due_date" });
  });

  it("refuses hidden tasks and other households", async () => {
    await expect(run(clients(null))).rejects.toMatchObject({ code: "task_not_found" });
    await expect(
      run(clients(task), [{ ...member, householdId: "99999999-9999-4999-8999-999999999999" }]),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("exports nothing if the audit event cannot be written", async () => {
    await expect(run(clients(task, true))).rejects.toMatchObject({ code: "database_failed" });
  });

  it("appears in the timeline in plain language", () => {
    const entry = describeAuditEvent(
      {
        id: "1",
        event_type: "calendar_event_created",
        actor_id: "u",
        payload: {},
        created_at: "2030-01-01T00:00:00Z",
      },
      new Map([["u", "Test Elder"]]),
    );
    expect(entry.text).toBe("Test Elder downloaded a calendar file for this task.");
  });
});
