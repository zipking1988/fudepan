import { describe, expect, it } from "vitest";
import { getCareChainDetail, getSharedCareEvent } from "./queries";

/** Rows shaped like the stored Alpha QA chain. All data is fake. */
const CHAIN_ID = "28a154ff-7259-4c76-a5ac-3aec6696943a";
const baseStep = {
  description: null,
  risk_level: "high",
  status: "pending_review",
  owner_id: null,
  backup_owner_id: null,
  evidence_required: [],
  approval_required: true,
  approval_state: null,
  confidence: 0.9,
  appointment_location: null,
  appointment_time: null,
  appointment_timezone: null,
};

function stubClient(steps: Record<string, unknown>[]) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: {
        id: CHAIN_ID,
        note_id: "62816fef-e33f-4c78-9470-4e1f71a9c46e",
        household_id: "d0000000-0000-4000-8000-000000000001",
        title: "Fake clinic visit",
        status: "pending_review",
        risk_level: "high",
        created_at: "2026-11-23T03:44:32Z",
        care_steps: steps,
      },
      error: null,
    }),
  };
  return { from: () => query } as unknown as Parameters<typeof getCareChainDetail>[0];
}

describe("getCareChainDetail: legacy appointment deadlines", () => {
  it("does not expose a stored model-guessed due_at/escalation_at on an appointment step", async () => {
    const chain = await getCareChainDetail(
      stubClient([
        {
          ...baseStep,
          id: "73e743bb-d117-4dbf-8921-f1acdfb76b74",
          title: "Attend clinic visit",
          care_category: "appointment",
          due_at: "2026-11-27T14:30:00+00:00",
          escalation_at: "2026-11-27T13:00:00+00:00",
          source_quote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
        },
        {
          ...baseStep,
          id: "a3000000-0000-4000-8000-000000000002",
          title: "Send the fake form",
          care_category: "document",
          due_at: "2026-11-20T08:00:00+00:00",
          escalation_at: "2026-11-20T09:00:00+00:00",
          source_quote: "Send form by 5:00 PM JST",
        },
      ]),
      CHAIN_ID,
    );

    const [appointment, document] = chain!.steps;
    expect(appointment).toMatchObject({
      dueAt: null,
      escalationAt: null,
      sourceQuote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
      approvalRequired: true,
      approvalState: null,
    });
    expect(document).toMatchObject({
      dueAt: "2026-11-20T08:00:00+00:00",
      escalationAt: "2026-11-20T09:00:00+00:00",
    });
  });
});

describe("approval_state reaches the step objects", () => {
  it("passes a stored approval_state through and keeps null for legacy rows", async () => {
    const chain = await getCareChainDetail(
      stubClient([
        { ...baseStep, id: "a", title: "A", care_category: "payment", approval_state: "approved" },
        { ...baseStep, id: "b", title: "B", care_category: "document" },
      ]) as never,
      CHAIN_ID,
    );
    expect(chain!.steps.map((s) => s.approvalState)).toEqual(["approved", null]);
  });
});

describe("getSharedCareEvent", () => {
  const NOTE_ID = "62816fef-e33f-4c78-9470-4e1f71a9c46e";
  const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
  const MEMBER_A = "a0000000-0000-4000-8000-0000000000a1";
  const STEP_ID = "73e743bb-d117-4dbf-8921-f1acdfb76b74";

  /** Table-keyed stub. Any select list is recorded so tests can check what was requested. */
  function tables(data: Record<string, unknown>) {
    const selects: Record<string, string> = {};
    const client = {
      from(table: string) {
        const rows = data[table];
        const q: Record<string, unknown> = {
          select: (cols: string) => {
            selects[table] = cols;
            return q;
          },
          eq: () => q,
          order: () => q,
          maybeSingle: async () => ({ data: rows ?? null, error: null }),
          then: (resolve: (v: unknown) => unknown) => resolve({ data: rows ?? [], error: null }),
        };
        return q;
      },
    };
    return { client: client as unknown as Parameters<typeof getSharedCareEvent>[0], selects };
  }

  const note = { id: NOTE_ID, household_id: HOUSEHOLD, status: "pending_review", created_at: "2026-11-23T03:44:00Z" };
  const chains = [
    { id: "c2", title: "Failed read", status: "extraction_failed", risk_level: "high", created_at: "2026-11-24T00:00:00Z" },
    { id: "c1", title: "Fake clinic visit", status: "pending_review", risk_level: "high", created_at: "2026-11-23T00:00:00Z" },
  ];
  const legacyStep = {
    ...baseStep,
    id: STEP_ID,
    title: "Attend clinic visit",
    care_category: "appointment",
    status: "completed",
    owner_id: MEMBER_A,
    driver_id: null,
    companion_id: null,
    plan_version: 1,
    suggested_role: "family",
    person_to_ask: null,
    required_amount_minor: null,
    due_at: "2026-11-27T14:30:00+00:00",
    escalation_at: "2026-11-27T13:00:00+00:00",
    respond_by_at: null,
    respond_by_timezone: null,
    respond_by_provenance: null,
    task_due_at: "2026-11-27T10:00:00+00:00",
    task_due_timezone: "Asia/Tokyo",
    task_due_provenance: "model_suggested",
    source_quote: null,
  };

  it("returns null when the note is not visible (other household)", async () => {
    const { client } = tables({ notes: null });
    expect(await getSharedCareEvent(client, NOTE_ID)).toBeNull();
    expect(await getSharedCareEvent(client, "not-a-uuid")).toBeNull();
  });

  it("maps a legacy completed appointment to approved and done, and hides legacy deadlines", async () => {
    const { client } = tables({
      notes: note,
      care_chains: chains,
      care_steps: [legacyStep],
      care_requests: [],
      part_evidence: [],
      part_missing_details: [],
      household_members: [{ id: MEMBER_A, display_name: "Ken" }],
    });
    const event = await getSharedCareEvent(client, NOTE_ID);
    expect(event).toMatchObject({ state: "ready", chainId: "c1", done: true });
    const part = event!.parts[0];
    expect(part.approvalState).toBe("approved");
    expect(part.progressStatus).toBe("completed");
    expect(part.owner).toEqual({ id: MEMBER_A, name: "Ken" });
    expect(part.suggestedRole).toBe("family");
    // Model-suggested task_due is separated from confirmed times; due_at never appears.
    expect(part.confirmed.taskDue).toBeNull();
    expect(part.suggested.taskDue?.provenance).toBe("model_suggested");
    expect(JSON.stringify(event)).not.toContain("2026-11-27T14:30:00");
    expect(JSON.stringify(event)).not.toContain("2026-11-27T13:00:00");
  });

  it("never selects or returns evidence text or storage paths", async () => {
    const { client, selects } = tables({
      notes: note,
      care_chains: chains,
      care_steps: [{ ...legacyStep, status: "in_progress" }],
      care_requests: [],
      part_evidence: [
        { id: "e1", care_step_id: STEP_ID, kind: "text", label: "Text note", text_body: "SECRET BODY", storage_path: "h/p.jpg" },
      ],
      part_missing_details: [],
      household_members: [],
    });
    const event = await getSharedCareEvent(client, NOTE_ID);
    expect(selects.part_evidence).not.toMatch(/text_body|storage_path/);
    expect(event!.parts[0].evidence).toEqual({
      required: [],
      attachedCount: 1,
      attached: [{ id: "e1", kind: "text", label: "Text note" }],
    });
    expect(JSON.stringify(event)).not.toContain("SECRET BODY");
    expect(JSON.stringify(event)).not.toContain("h/p.jpg");
  });

  it("returns a reading event with no parts when only a failed chain exists and the note is extracting", async () => {
    const { client } = tables({
      notes: { ...note, status: "extracting" },
      care_chains: [chains[0]],
    });
    expect(await getSharedCareEvent(client, NOTE_ID)).toMatchObject({
      state: "reading",
      chainId: null,
      parts: [],
      done: false,
    });
  });
});
