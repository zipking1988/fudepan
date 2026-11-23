import { describe, expect, it } from "vitest";
import {
  careChainDraftSchema,
  normalizeCareChainDraft,
  validateCareChainDraft,
  type CareChainDraft,
} from "@/lib/ai/schema";
import { mapDraftToRows, validateDraftRowsPayload } from "@/lib/care/draft-rows";

type StepInput = Record<string, unknown>;

function step(over: StepInput = {}): StepInput {
  return {
    title: "Buy groceries",
    care_category: "household",
    risk_level: "low",
    approval_required: false,
    confidence: 0.9,
    ...over,
  };
}

function draft(steps: StepInput[], extra: Record<string, unknown> = {}): CareChainDraft {
  return careChainDraftSchema.parse({
    chain_title: "Week plan",
    overall_risk: "medium",
    steps,
    ambiguities: [],
    ...extra,
  });
}

const FORBIDDEN_KEYS = [
  "owner_id",
  "backup_owner_id",
  "driver_id",
  "companion_id",
  "owner",
  "backup_owner",
  "driver",
  "companion",
  "assigned_to",
];

describe("mapDraftToRows: QA note", () => {
  const qa = normalizeCareChainDraft(
    draft(
      [
        step({
          title: "Ask Misa which clinic",
          care_category: "communication",
          person_to_ask: "Misa",
          suggested_owner_role: "family",
          source_quote: "Ask Misa which clinic",
        }),
        step({
          title: "Dentist visit",
          care_category: "appointment",
          risk_level: "medium",
          approval_required: true,
          due_at: "2026-11-27T14:30:00Z",
          escalation_at: "2026-11-26T09:00:00Z",
          source_quote: "Dentist Nov 27 at 14:30",
        }),
        step({
          title: "Pick up medicine",
          care_category: "medication",
          risk_level: "high",
          approval_required: true,
          evidence_required: ["Receipt"],
        }),
        step({ title: "Buy rice", source_quote: "rice" }),
      ],
      {
        ambiguities: [{ field: "location", question: "Which clinic?", reason: "missing", step_index: 1, kind: "location" }],
      },
    ),
  );

  it("maps four steps, nulls appointment times, keeps person_to_ask as text", () => {
    expect(validateCareChainDraft(qa)).toEqual([]);
    const { payload } = mapDraftToRows(qa);
    expect(payload.steps).toHaveLength(4);
    expect(payload.steps[1].care_category).toBe("appointment");
    expect(payload.steps[1].due_at).toBeNull();
    expect(payload.steps[1].escalation_at).toBeNull();
    expect(payload.steps[0].person_to_ask).toBe("Misa");
    expect(payload.steps[0].suggested_role).toBe("family");
    expect(payload.steps[0].approval_state).toBe("not_required");
    expect(payload.steps[2].approval_state).toBe("pending");
    expect(payload.ambiguities).toEqual([{ step_index: 1, kind: "location", question: "Which clinic?" }]);
    expect(validateDraftRowsPayload(payload).ok).toBe(true);
  });

  it("sends no people-assignment fields", () => {
    const { payload } = mapDraftToRows(qa);
    for (const s of payload.steps) {
      for (const key of FORBIDDEN_KEYS) expect(s).not.toHaveProperty(key);
    }
  });
});

describe("mapDraftToRows: forced approval", () => {
  it.each(["medical", "medication", "appointment", "payment", "transport", "document"])(
    "forces approval for %s even when the draft says false",
    (category) => {
      const { payload } = mapDraftToRows(draft([step({ care_category: category })]));
      expect(payload.steps[0].approval_required).toBe(true);
      expect(payload.steps[0].approval_state).toBe("pending");
      expect(validateDraftRowsPayload(payload).ok).toBe(true);
    },
  );

  it("forces approval for high risk and leaves low-risk household alone", () => {
    const { payload } = mapDraftToRows(draft([step({ risk_level: "high" }), step()]));
    expect(payload.steps[0].approval_required).toBe(true);
    expect(payload.steps[1].approval_required).toBe(false);
    expect(payload.steps[1].approval_state).toBe("not_required");
  });

  it("the validator refuses a mismatched payload", () => {
    const { payload } = mapDraftToRows(draft([step()]));
    const bad = { ...payload, steps: [{ ...payload.steps[0], approval_state: "pending" }] };
    expect(validateDraftRowsPayload(bad).ok).toBe(false);
    const bad2 = { ...payload, steps: [{ ...payload.steps[0], risk_level: "high" }] };
    expect(validateDraftRowsPayload(bad2).ok).toBe(false);
  });
});

describe("mapDraftToRows: cleaning and limits", () => {
  it("trims, nulls empties, clamps confidence, and keeps valid times on non-appointments", () => {
    const d = draft([step({ description: "   ", suggested_owner_role: "  ", due_at: "2026-11-27T14:30:00Z" })]);
    d.steps[0].confidence = 7;
    const { payload } = mapDraftToRows(d);
    expect(payload.steps[0].description).toBeNull();
    expect(payload.steps[0].suggested_role).toBeNull();
    expect(payload.steps[0].confidence).toBe(1);
    expect(payload.steps[0].due_at).toBe("2026-11-27T14:30:00Z");
  });

  it("drops timestamps that are not ISO with a zone instead of guessing", () => {
    const d = draft([step({ due_at: "2026-11-27" })]);
    expect(mapDraftToRows(d).payload.steps[0].due_at).toBeNull();
  });

  it("cuts evidence labels and the evidence list to SQL limits", () => {
    const d = draft([step()]);
    d.steps[0].evidence_required = [...Array.from({ length: 60 }, (_, i) => `item ${i}`), "x".repeat(250), "  "];
    const { payload } = mapDraftToRows(d);
    expect(payload.steps[0].evidence_required).toHaveLength(50);
    const d2 = draft([step()]);
    d2.steps[0].evidence_required = ["x".repeat(250)];
    expect(mapDraftToRows(d2).payload.steps[0].evidence_required[0]).toHaveLength(200);
  });

  it("truncates long strings by characters and keeps the payload valid", () => {
    const d = draft([step()]);
    d.chain_title = "T".repeat(300);
    d.steps[0].title = "😀".repeat(250);
    d.steps[0].description = "d".repeat(1200);
    d.steps[0].source_quote = "q".repeat(600);
    d.steps[0].suggested_owner_role = "r".repeat(150);
    d.steps[0].person_to_ask = "p".repeat(150);
    const { payload } = mapDraftToRows(d);
    expect(payload.chain_title).toHaveLength(200);
    expect(Array.from(payload.steps[0].title)).toHaveLength(200);
    expect(payload.steps[0].description).toHaveLength(1000);
    expect(payload.steps[0].source_quote).toHaveLength(500);
    expect(payload.steps[0].suggested_role).toHaveLength(100);
    expect(payload.steps[0].person_to_ask).toHaveLength(100);
    expect(validateDraftRowsPayload(payload).ok).toBe(true);
  });

  it("keeps at most 50 steps and drops ambiguities that point past them", () => {
    const d = draft(Array.from({ length: 50 }, () => step()));
    d.steps.push(d.steps[0]);
    d.ambiguities = [{ field: "x", question: "q", reason: "r", step_index: 50, kind: "date" }];
    const result = mapDraftToRows(d);
    expect(result.payload.steps).toHaveLength(50);
    expect(result.payload.ambiguities).toEqual([]);
    expect(result.unlinkedAmbiguityCount).toBe(1);
  });
});

describe("mapDraftToRows: ambiguities", () => {
  const amb = (over: Record<string, unknown>) => ({
    field: "x",
    question: "Which?",
    reason: "r",
    step_index: null,
    kind: "location",
    ...over,
  });

  it("uses step_index, legacy steps[N] (zero-based) and step N (one-based)", () => {
    const d = draft([step(), step(), step()], {
      ambiguities: [
        amb({ step_index: 2 }),
        amb({ field: "steps[1].location" }),
        amb({ field: "Step 1 due_at", kind: "time" }),
      ],
    });
    const { payload, unlinkedAmbiguityCount } = mapDraftToRows(d);
    expect(payload.ambiguities.map((a) => a.step_index)).toEqual([2, 1, 0]);
    expect(unlinkedAmbiguityCount).toBe(0);
  });

  it("drops and counts ambiguities with no usable step or kind", () => {
    const d = draft([step()], {
      ambiguities: [
        amb({ field: "general" }),
        amb({ field: "steps[5]" }),
        amb({ field: "step 0" }),
        amb({ step_index: 0, kind: null }),
      ],
    });
    const { payload, unlinkedAmbiguityCount } = mapDraftToRows(d);
    expect(payload.ambiguities).toEqual([]);
    expect(unlinkedAmbiguityCount).toBe(4);
  });

  it("sends a null question when empty", () => {
    const d = draft([step()], { ambiguities: [amb({ step_index: 0, question: " " })] });
    expect(mapDraftToRows(d).payload.ambiguities[0].question).toBeNull();
  });
});

describe("mapDraftToRows: never assigns people", () => {
  const categories = ["medical", "medication", "appointment", "payment", "transport", "document", "household", "communication"];
  const risks = ["low", "medium", "high"];
  const names = ["Misa", "Dr. Sato", "me", "Taro (driver)"];

  it("holds for varied drafts", () => {
    let n = 0;
    for (const category of categories) {
      for (const risk of risks) {
        for (const approval of [true, false]) {
          const person = names[n++ % names.length];
          const d = normalizeCareChainDraft(
            draft([
              step({
                care_category: category,
                risk_level: risk,
                approval_required: approval,
                person_to_ask: person,
                suggested_owner_role: "driver",
                due_at: "2026-11-27T14:30:00Z",
                escalation_at: "2026-11-27T10:00:00Z",
                source_quote: "at 14:30",
              }),
            ]),
          );
          const { payload } = mapDraftToRows(d);
          const s = payload.steps[0];
          for (const key of FORBIDDEN_KEYS) expect(s).not.toHaveProperty(key);
          expect(Object.keys(s).sort()).toEqual(
            [
              "title", "description", "care_category", "risk_level", "suggested_role", "person_to_ask",
              "evidence_required", "approval_required", "approval_state", "source_quote", "confidence",
              "due_at", "escalation_at",
            ].sort(),
          );
          expect(s.approval_state).toBe(s.approval_required ? "pending" : "not_required");
          if (category === "appointment") {
            expect(s.due_at).toBeNull();
            expect(s.escalation_at).toBeNull();
          }
          expect(validateDraftRowsPayload(payload).ok).toBe(true);
        }
      }
    }
  });
});
