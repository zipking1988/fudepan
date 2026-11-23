import { describe, expect, it } from "vitest";

import {
  getEventTimeline,
  labelForEvent,
  TIMELINE_EVENT_LABELS,
  TIMELINE_LABEL_KEYS,
  TIMELINE_UNKNOWN_LABEL_KEY,
} from "./timeline";

describe("labelForEvent", () => {
  it("returns a known label for documented event types", () => {
    expect(labelForEvent("step_approved")).toBe("Step confirmed by family member");
    expect(labelForEvent("step_escalated")).toBe("Step escalated — deadline passed");
    expect(labelForEvent("evidence_uploaded")).toBe("Evidence uploaded");
    expect(labelForEvent("escalation_notified")).toBe("Escalation notification recorded");
  });

  it("falls back to humanised event name for unknown types", () => {
    expect(labelForEvent("some_new_event_type")).toBe("some new event type");
  });

  it("covers all events listed in TIMELINE_EVENT_LABELS", () => {
    for (const key of Object.keys(TIMELINE_EVENT_LABELS)) {
      expect(labelForEvent(key)).toBe(TIMELINE_EVENT_LABELS[key]);
    }
  });
});

describe("escalation_notified label", () => {
  it("makes clear the notification is recorded, not delivered", () => {
    const label = labelForEvent("escalation_notified");
    expect(label.toLowerCase()).toContain("notification");
    expect(label.toLowerCase()).toContain("recorded");
  });
});

// ---------------------------------------------------------------------------
// getEventTimeline
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  household_id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
  care_step_id: string | null;
  care_chain_id?: string | null;
  note_id?: string | null;
  payload: Record<string, unknown>;
};

const NOTE = "note-1";
const CHAIN = "chain-1";
const H1 = "h1";

function ev(id: string, type: string, at: string, extra: Partial<Row> = {}): Row {
  return {
    id,
    household_id: H1,
    event_type: type,
    actor_type: "human",
    actor_id: null,
    created_at: at,
    care_step_id: null,
    payload: {},
    ...extra,
  };
}

/** Stub of the RLS client: only rows of `visible` households are returned. */
function stubClient(rows: Row[], visible: string[] = [H1]) {
  const members = [{ household_id: H1, user_id: "u1", display_name: "Aiko" }];
  const steps = [{ id: "s1", title: "Pick up" }];
  const client = {
    from(table: string) {
      const state = { mode: "", ids: [] as string[] };
      const b: Record<string, unknown> = {};
      const result = () => {
        if (table === "care_chains") return { data: [{ id: CHAIN }], error: null };
        if (table === "household_members") return { data: members, error: null };
        if (table === "care_steps") return { data: steps, error: null };
        const own = rows.filter((r) => visible.includes(r.household_id));
        if (state.mode === "legacy") {
          return {
            data: own.filter((r) => (r.note_id ?? null) === null && r.payload.note_id === NOTE),
            error: null,
          };
        }
        return {
          data: own.filter((r) => r.note_id === NOTE || r.care_chain_id === CHAIN),
          error: null,
        };
      };
      for (const m of ["select", "eq", "in", "order"]) b[m] = () => b;
      b.or = () => ((state.mode = "main"), b);
      b.is = () => b;
      b.filter = () => ((state.mode = "legacy"), b);
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
      return b;
    },
  };
  return client as unknown as Parameters<typeof getEventTimeline>[0];
}

describe("getEventTimeline", () => {
  it("merges note, chain and legacy rows once, oldest first, ties by id", async () => {
    const rows = [
      ev("e3", "approval.given", "2026-01-01T10:00:00Z", { note_id: NOTE, care_chain_id: CHAIN }),
      ev("e1", "note.uploaded", "2026-01-01T08:00:00Z", { note_id: NOTE }),
      ev("e2", "extraction_started", "2026-01-01T09:00:00Z", { payload: { note_id: NOTE } }),
      ev("e5", "part.claimed", "2026-01-01T10:00:00Z", { care_chain_id: CHAIN }),
      ev("e4", "part.completed", "2026-01-01T10:00:00Z", { care_chain_id: CHAIN, note_id: NOTE }),
    ];
    const out = await getEventTimeline(stubClient(rows), NOTE);
    expect(out.map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  it("includes events that exist before any chain does", async () => {
    const rows = [ev("e1", "note.uploaded", "2026-01-01T08:00:00Z", { note_id: NOTE })];
    const out = await getEventTimeline(stubClient(rows), NOTE);
    expect(out[0]).toMatchObject({ labelKey: "timeline.note_uploaded" });
  });

  it("never shows events of households the caller cannot see", async () => {
    const rows = [
      ev("e1", "note.uploaded", "2026-01-01T08:00:00Z", { note_id: NOTE }),
      ev("x1", "note.uploaded", "2026-01-01T08:00:00Z", { note_id: NOTE, household_id: "h2" }),
    ];
    const out = await getEventTimeline(stubClient(rows), NOTE);
    expect(out.map((e) => e.id)).toEqual(["e1"]);
  });

  it("uses the self-approval label and resolves names and titles", async () => {
    const rows = [
      ev("e1", "approval.given", "2026-01-01T08:00:00Z", {
        note_id: NOTE,
        actor_id: "u1",
        care_step_id: "s1",
        payload: { self_approval: true },
      }),
      ev("e2", "approval.given", "2026-01-01T09:00:00Z", {
        note_id: NOTE,
        payload: { self_approval: false },
      }),
    ];
    const out = await getEventTimeline(stubClient(rows), NOTE);
    expect(out[0]).toMatchObject({
      labelKey: "timeline.approval_self",
      actorName: "Aiko",
      stepTitle: "Pick up",
    });
    expect(out[1]!.labelKey).toBe("timeline.approval_given");
  });

  it("falls back to a neutral key for unknown types", async () => {
    const rows = [ev("e1", "weird.thing", "2026-01-01T08:00:00Z", { note_id: NOTE })];
    const out = await getEventTimeline(stubClient(rows), NOTE);
    expect(out[0]!.labelKey).toBe(TIMELINE_UNKNOWN_LABEL_KEY);
    expect(TIMELINE_LABEL_KEYS).toContain(TIMELINE_UNKNOWN_LABEL_KEY);
  });

  it("keeps payload free text out of params", async () => {
    const rows = [
      ev("e1", "appointment_clarified", "2026-01-01T08:00:00Z", {
        note_id: NOTE,
        payload: { location: "12 Oak Street Clinic", role: "owner", missing_count: 2, kind: "Take Aspirin now" },
      }),
    ];
    const out = await getEventTimeline(stubClient(rows), NOTE);
    expect(out[0]!.params).toEqual({ role: "owner", missing_count: 2 });
    expect(JSON.stringify(out[0])).not.toContain("Oak");
    expect(JSON.stringify(out[0])).not.toContain("Aspirin");
  });
});
