import { describe, expect, it } from "vitest";

import { careChainDraftSchema, validateCareChainDraft, normalizeCareChainDraft } from "./schema";

/** Minimal valid fictional note draft — no real personal or medical information. */
const VALID_DRAFT = {
  chain_title: "Weekly groceries",
  overall_risk: "low",
  steps: [
    {
      title: "Buy milk and bread",
      description: "Pick up from the shop on the corner.",
      care_category: "household",
      risk_level: "low",
      suggested_owner_role: "family_member",
      due_at: null,
      escalation_at: null,
      evidence_required: [],
      approval_required: false,
      source_quote: "get milk + bread",
      confidence: 0.9,
    },
  ],
  ambiguities: [],
  ai_boundary: {
    medical_advice_requested: false,
    blocked_actions: [],
    explanation: "",
  },
};

describe("careChainDraftSchema", () => {
  it("accepts a valid low-risk draft", () => {
    const result = careChainDraftSchema.safeParse(VALID_DRAFT);
    expect(result.success).toBe(true);
  });

  it("rejects a draft with no steps", () => {
    const result = careChainDraftSchema.safeParse({ ...VALID_DRAFT, steps: [] });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid risk_level", () => {
    const step = { ...VALID_DRAFT.steps[0], risk_level: "critical" };
    const result = careChainDraftSchema.safeParse({ ...VALID_DRAFT, steps: [step] });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid care_category", () => {
    const step = { ...VALID_DRAFT.steps[0], care_category: "magic" };
    const result = careChainDraftSchema.safeParse({ ...VALID_DRAFT, steps: [step] });
    expect(result.success).toBe(false);
  });

  it("coerces missing ambiguities to empty array", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ambiguities: _a, ...withoutAmbiguities } = VALID_DRAFT;
    const result = careChainDraftSchema.safeParse(withoutAmbiguities);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.ambiguities).toEqual([]);
  });
});

describe("person_to_ask and ambiguity link fields", () => {
  const apptStep = {
    ...VALID_DRAFT.steps[0],
    title: "Find out which clinic",
    care_category: "appointment",
    risk_level: "high",
    approval_required: true,
    person_to_ask: "Misa",
    suggested_owner_role: "a family member who drives",
    source_quote: "Ask Misa which clinic",
  };

  it("defaults the new fields so older drafts stay valid", () => {
    const result = careChainDraftSchema.parse({
      ...VALID_DRAFT,
      ambiguities: [{ field: "location", question: "Which clinic?", reason: "Not written" }],
    });
    expect(result.steps[0].person_to_ask).toBeNull();
    expect(result.ambiguities[0].step_index).toBeNull();
    expect(result.ambiguities[0].kind).toBeNull();
  });

  it("keeps 'Ask Misa which clinic' as person_to_ask with no owner", () => {
    const parsed = careChainDraftSchema.parse({
      ...VALID_DRAFT,
      steps: [{ ...apptStep, owner_id: "u1", assigned_to: "Misa" }],
    });
    const step = parsed.steps[0] as Record<string, unknown>;
    expect(step.person_to_ask).toBe("Misa");
    expect(step.owner_id).toBeUndefined();
    expect(step.assigned_to).toBeUndefined();
    expect(validateCareChainDraft(normalizeCareChainDraft(parsed))).toEqual([]);
  });

  it("rejects empty, too long, or non-string person_to_ask", () => {
    for (const bad of ["  ", "x".repeat(101), 5]) {
      const r = careChainDraftSchema.safeParse({
        ...VALID_DRAFT,
        steps: [{ ...VALID_DRAFT.steps[0], person_to_ask: bad }],
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejects an unknown ambiguity kind and a negative step_index", () => {
    for (const extra of [{ kind: "diagnosis" }, { step_index: -1 }]) {
      const r = careChainDraftSchema.safeParse({
        ...VALID_DRAFT,
        ambiguities: [{ field: "f", question: "q", reason: "r", ...extra }],
      });
      expect(r.success).toBe(false);
    }
  });

  it("still nulls model deadlines on appointment steps", () => {
    const parsed = careChainDraftSchema.parse({
      ...VALID_DRAFT,
      steps: [
        {
          ...apptStep,
          due_at: "2026-11-20T15:00:00+09:00",
          escalation_at: "2026-11-20T14:00:00+09:00",
          source_quote: "Clinic 3:00 PM",
        },
      ],
    });
    const step = normalizeCareChainDraft(parsed).steps[0];
    expect(step.due_at).toBeNull();
    expect(step.escalation_at).toBeNull();
    expect(step.person_to_ask).toBe("Misa");
  });

  it("drops an ambiguity step_index that points past the last step", () => {
    const parsed = careChainDraftSchema.parse({
      ...VALID_DRAFT,
      ambiguities: [
        { field: "a", question: "q", reason: "r", step_index: 0, kind: "location" },
        { field: "b", question: "q", reason: "r", step_index: 7, kind: "date" },
      ],
    });
    const out = normalizeCareChainDraft(parsed).ambiguities;
    expect(out[0].step_index).toBe(0);
    expect(out[1].step_index).toBeNull();
    expect(out[1].kind).toBe("date");
  });

  it("still flags a high-risk step that skips approval, whatever person_to_ask says", () => {
    const parsed = careChainDraftSchema.parse({
      ...VALID_DRAFT,
      steps: [{ ...apptStep, approval_required: false }],
    });
    expect(validateCareChainDraft(parsed).length).toBeGreaterThan(0);
  });
});

describe("validateCareChainDraft", () => {
  it("returns no violations for a valid draft", () => {
    const parsed = careChainDraftSchema.parse(VALID_DRAFT);
    expect(validateCareChainDraft(parsed)).toEqual([]);
  });

  it("flags a high-risk step without approval_required", () => {
    const step = { ...VALID_DRAFT.steps[0], risk_level: "high", approval_required: false };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const violations = validateCareChainDraft(draft);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/high-risk/);
  });

  it("flags a medical step without approval_required", () => {
    const step = { ...VALID_DRAFT.steps[0], care_category: "medical", approval_required: false };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const violations = validateCareChainDraft(draft);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("flags a payment step without approval_required", () => {
    const step = { ...VALID_DRAFT.steps[0], care_category: "payment", approval_required: false };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const violations = validateCareChainDraft(draft);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("flags when ai_boundary.medical_advice_requested is true", () => {
    const draft = careChainDraftSchema.parse({
      ...VALID_DRAFT,
      ai_boundary: { medical_advice_requested: true, blocked_actions: [], explanation: "" },
    });
    const violations = validateCareChainDraft(draft);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/medical_advice_requested/);
  });

  it("accepts a high-risk step that correctly has approval_required: true", () => {
    const step = { ...VALID_DRAFT.steps[0], risk_level: "high", approval_required: true };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const violations = validateCareChainDraft(draft);
    expect(violations).toEqual([]);
  });
});

describe("normalizeCareChainDraft", () => {
  it("clears AI-invented time when source quote has only a date", () => {
    // Real bug: note says "Friday, November 20, 2026" but AI adds 9:00 AM
    const step = {
      title: "Clinic visit",
      description: "Bring insurance card",
      care_category: "appointment" as const,
      risk_level: "high" as const,
      suggested_owner_role: "family_member",
      approval_required: true,
      due_at: "2026-11-20T09:00:00Z", // AI invented 9:00 AM
      escalation_at: null,
      evidence_required: [],
      source_quote: "Friday, November 20, 2026. Bring the insurance card to the clinic visit.",
      confidence: 0.9,
    };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const normalized = normalizeCareChainDraft(draft);

    // Unsupported deadline should be cleared
    expect(normalized.steps[0].due_at).toBeNull();

    // Ambiguity should be added
    expect(normalized.ambiguities.length).toBeGreaterThan(0);
    const timeAmbiguity = normalized.ambiguities.find((a) => a.field.includes("due_at"));
    expect(timeAmbiguity).toBeDefined();
    expect(timeAmbiguity!.reason).toContain("date but not a specific time");
  });

  it("preserves explicit time when source quote mentions that time", () => {
    // Valid case: source quote has "5:00 PM" and due_at reflects it
    const step = {
      title: "Check response",
      description: "Call family",
      care_category: "communication" as const,
      risk_level: "medium" as const,
      suggested_owner_role: "family_member",
      approval_required: false,
      due_at: "2026-11-20T17:00:00+09:00", // 5:00 PM JST
      escalation_at: "2026-11-20T18:00:00+09:00", // 6:00 PM JST
      evidence_required: [],
      source_quote: "Check by 5:00 PM JST. If unanswered by 6:00 PM JST, ask the backup person.",
      confidence: 0.95,
    };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const normalized = normalizeCareChainDraft(draft);

    // Supported deadlines should be preserved
    expect(normalized.steps[0].due_at).toBe("2026-11-20T17:00:00+09:00");
    expect(normalized.steps[0].escalation_at).toBe("2026-11-20T18:00:00+09:00");

    // No new ambiguities should be added
    expect(normalized.ambiguities.length).toBe(0);
  });

  it("clears midnight timestamp when no time is mentioned", () => {
    // Midnight often indicates date-only, should be cleared
    const step = {
      ...VALID_DRAFT.steps[0],
      due_at: "2026-11-20T00:00:00Z", // Midnight UTC
      source_quote: "Friday, November 20, 2026",
    };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const normalized = normalizeCareChainDraft(draft);

    expect(normalized.steps[0].due_at).toBeNull();
  });

  it("does not count 'morning' as explicit time evidence", () => {
    // Generic words like "morning" don't prove a specific time
    const step = {
      ...VALID_DRAFT.steps[0],
      due_at: "2026-11-20T09:00:00Z",
      source_quote: "Friday morning, November 20",
    };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const normalized = normalizeCareChainDraft(draft);

    // Should be cleared because "morning" is not explicit
    expect(normalized.steps[0].due_at).toBeNull();
  });

  it("preserves high-risk approval requirement after normalization", () => {
    // Ensure safety validation still works after normalization
    const step = {
      ...VALID_DRAFT.steps[0],
      care_category: "appointment" as const,
      risk_level: "high" as const,
      approval_required: true,
      due_at: "2026-11-20T09:00:00Z", // Will be cleared
      source_quote: "Friday, November 20, 2026",
    };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [step] });
    const normalized = normalizeCareChainDraft(draft);

    // Timestamp cleared
    expect(normalized.steps[0].due_at).toBeNull();

    // But approval_required still set
    expect(normalized.steps[0].approval_required).toBe(true);

    // And safety validation passes
    expect(validateCareChainDraft(normalized)).toEqual([]);
  });
});

describe("normalizeCareChainDraft: appointment steps (Alpha QA regression)", () => {
  // The model read "2:30 pm" correctly but returned 14:30 UTC, shown as 11:30 PM in Tokyo.
  const qaAppointment = {
    title: "Attend clinic visit",
    description: "Clinic name not stated.",
    care_category: "appointment" as const,
    risk_level: "high" as const,
    suggested_owner_role: "family_member",
    approval_required: true,
    due_at: "2026-11-27T14:30:00Z",
    escalation_at: "2026-11-27T13:00:00Z",
    evidence_required: [],
    source_quote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
    confidence: 0.9,
  };

  it("drops the model's due_at and escalation_at and keeps the quote and approval gate", () => {
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, overall_risk: "high", steps: [qaAppointment] });
    const normalized = normalizeCareChainDraft(draft);

    expect(normalized.steps[0]).toMatchObject({
      due_at: null,
      escalation_at: null,
      source_quote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
      approval_required: true,
      risk_level: "high",
    });
    expect(validateCareChainDraft(normalized)).toEqual([]);
  });

  it("leaves deadlines on other categories in the same draft unchanged", () => {
    const reply = {
      ...VALID_DRAFT.steps[0],
      care_category: "communication" as const,
      due_at: "2026-11-20T17:00:00+09:00",
      source_quote: "Reply by 5:00 PM JST",
    };
    const draft = careChainDraftSchema.parse({ ...VALID_DRAFT, steps: [qaAppointment, reply] });
    const normalized = normalizeCareChainDraft(draft);

    expect(normalized.steps[0].due_at).toBeNull();
    expect(normalized.steps[1].due_at).toBe("2026-11-20T17:00:00+09:00");
  });
});
