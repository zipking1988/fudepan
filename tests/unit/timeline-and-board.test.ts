import { describe, expect, it } from "vitest";
import { buildTimeline, describeAuditEvent } from "@/lib/workflow/timeline";
import { filterTasks, parseBoardFilters } from "@/lib/workflow/board-filters";
import {
  buildInviteUrl,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
} from "@/lib/invitations";
import { safeNextPath } from "@/lib/safe-redirect";
import { DEMO_MEMBERS, DEMO_NOTE_TEXT, DEMO_SUGGESTION, nextWeekday } from "@/lib/demo/fixtures";
import { maskSensitive } from "@/lib/safety/mask-sensitive";
import { fieldWarnings, EMPTY_TASK_VALUES } from "@/components/TaskFieldsForm";

const names = new Map([["u1", "Test Caregiver"]]);
const ev = (
  event_type: string,
  payload: Record<string, unknown> = {},
  created_at = "2030-01-01T00:00:00Z",
) => ({
  id: `${event_type}-${created_at}`,
  event_type,
  actor_id: "u1",
  payload,
  created_at,
});

describe("timeline", () => {
  it("describes events in plain language with the actor's name", () => {
    expect(describeAuditEvent(ev("task_approved"), names).text).toBe(
      "Test Caregiver approved the task.",
    );
    expect(describeAuditEvent(ev("task_approved"), names).details[0]).toMatch(
      /Nothing was paid, booked, or sent/,
    );
    expect(describeAuditEvent(ev("task_updated", { action: "claim" }), names).text).toBe(
      "Test Caregiver took this task.",
    );
    expect(describeAuditEvent(ev("task_confirmation_requested"), names).text).toBe(
      "Test Caregiver asked for approval.",
    );
    expect(
      describeAuditEvent(
        ev("task_updated", { action: "edit", edited_fields: ["title", "due_at"] }),
        names,
      ).details,
    ).toEqual(["Changed: title, due date"]);
    expect(describeAuditEvent({ ...ev("task_completed"), actor_id: "stranger" }, names).text).toBe(
      "A household member marked the task as done.",
    );
  });

  it("never shows raw sensitive values or unknown payload fields", () => {
    const e = describeAuditEvent(
      ev("task_cancelled", { reason: "card 4242 4242 4242 4242", secret: "hunter22" }),
      names,
    );
    expect(JSON.stringify(e)).not.toMatch(/4242 4242|hunter22/);
    const x = describeAuditEvent(
      ev("task_extracted", {
        status: "ok",
        confidence: 0.8,
        parsed: { title: "Pay [MASKED] now" },
        model: "m",
      }),
      names,
    );
    expect(x.text).toContain("80%");
  });

  it("sorts oldest first", () => {
    const list = buildTimeline(
      [
        ev("task_approved", {}, "2030-01-02T00:00:00Z"),
        ev("note_created", {}, "2030-01-01T00:00:00Z"),
      ],
      names,
    );
    expect(list.map((e) => e.text)).toEqual([
      "Test Caregiver added a text note.",
      "Test Caregiver approved the task.",
    ]);
  });
});

describe("board filters", () => {
  const now = new Date("2030-01-09T23:00:00Z"); // 08:00 on 10 Jan in Tokyo
  const tasks = [
    {
      id: "a",
      status: "draft",
      assignee_id: null,
      category: "medication",
      risk_level: "high",
      due_at: "2030-01-10T09:00:00+09:00",
    },
    {
      id: "b",
      status: "confirmed",
      assignee_id: "me",
      category: "reminder",
      risk_level: "low",
      due_at: "2030-01-05T09:00:00+09:00",
    },
    {
      id: "c",
      status: "completed",
      assignee_id: "other",
      category: "payment",
      risk_level: "high",
      due_at: null,
    },
    {
      id: "d",
      status: "awaiting_confirmation",
      assignee_id: "other",
      category: "pickup",
      risk_level: "high",
      due_at: "2030-01-15T09:00:00+09:00",
    },
  ];
  const run = (q: Record<string, string>) =>
    filterTasks(tasks, parseBoardFilters(q), { memberId: "me", now, timeZone: "Asia/Tokyo" }).map(
      (t) => t.id,
    );

  it("defaults to open tasks", () => expect(run({})).toEqual(["a", "b", "d"]));
  it("filters by status, assignee, category, risk and due date", () => {
    expect(run({ status: "completed" })).toEqual(["c"]);
    expect(run({ assignee: "me" })).toEqual(["b"]);
    expect(run({ assignee: "none" })).toEqual(["a"]);
    expect(run({ category: "pickup" })).toEqual(["d"]);
    expect(run({ risk: "low" })).toEqual(["b"]);
    expect(run({ due: "today" })).toEqual(["a"]);
    expect(run({ due: "overdue" })).toEqual(["b"]);
    expect(run({ due: "week" })).toEqual(["a", "d"]);
    expect(run({ status: "completed", due: "none" })).toEqual(["c"]);
  });
  it("ignores unknown filter values instead of failing", () => {
    expect(run({ status: "hacked", risk: "x", assignee: "'; drop table" })).toEqual([
      "a",
      "b",
      "d",
    ]);
  });
});

describe("invitations and redirects", () => {
  it("creates random single-use tokens and stores only a hash", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashInviteToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(a)).not.toContain(a);
    expect(buildInviteUrl("https://x.test/", a)).toBe(`https://x.test/invite/${a}`);
    expect(inviteExpiry(new Date("2030-01-01T00:00:00Z")).toISOString()).toBe(
      "2030-01-08T00:00:00.000Z",
    );
  });
  it("only allows same-site redirect paths", () => {
    expect(safeNextPath("/board")).toBe("/board");
    expect(safeNextPath("/#add-note")).toBe("/#add-note");
    for (const bad of [
      "https://evil.test",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});

describe("demo fixtures", () => {
  it("contain no sensitive values and are labelled as examples", () => {
    const all = JSON.stringify({ DEMO_MEMBERS, DEMO_NOTE_TEXT, DEMO_SUGGESTION });
    expect(maskSensitive(all).kinds).toEqual([]);
    expect(all).not.toMatch(/@/);
    for (const m of DEMO_MEMBERS) expect(m.display_name).toMatch(/\(example\)$/);
    expect(DEMO_SUGGESTION.category).toBe("medication");
  });
  it("computes the next weekday", () => {
    expect(nextWeekday("2030-01-01", 4)).toBe("2030-01-03");
    expect(nextWeekday("2030-01-03", 4)).toBe("2030-01-10");
  });
});

describe("field warnings on the review form", () => {
  it("puts each warning beside the field it is about", () => {
    const w = fieldWarnings(
      { ...EMPTY_TASK_VALUES, dueDate: "2030-01-01" },
      ["assigneeSuggestion", "title"],
      ["category_adjusted", "date_in_past"],
    );
    expect(Object.keys(w).sort()).toEqual(["assignee", "category", "dueDate", "dueTime", "title"]);
    expect(w.dueTime?.[0]).toMatch(/9:00/);
  });
});
