import { describe, expect, it } from "vitest";
import {
  DRAFT_STATUS,
  EXTRACTION_FIELDS,
  LLM_TASK_JSON_SCHEMA,
  draftTaskInputSchema,
  extractedTaskSchema,
  llmTaskOutputSchema,
} from "@/lib/task-schema";

const valid = {
  title: "Pick up prescription",
  category: "medication",
  dueDate: "2030-01-05",
  dueTime: "15:30",
  location: "Sun Pharmacy",
  assigneeSuggestion: "Hanako",
  notes: null,
  confidence: 0.9,
  uncertainFields: [],
};
const id = "11111111-1111-4111-8111-111111111111";

describe("llmTaskOutputSchema", () => {
  it("accepts a valid response", () => {
    expect(llmTaskOutputSchema.safeParse(valid).success).toBe(true);
  });
  it("turns empty strings into null", () => {
    const r = llmTaskOutputSchema.parse({ ...valid, location: "  ", notes: "" });
    expect(r.location).toBeNull();
    expect(r.notes).toBeNull();
  });
  it("rejects missing required fields", () => {
    for (const key of ["title", "category", "confidence", "uncertainFields", "dueDate"]) {
      const copy: Record<string, unknown> = { ...valid };
      delete copy[key];
      expect(llmTaskOutputSchema.safeParse(copy).success).toBe(false);
    }
  });
  it("rejects unknown categories, impossible dates, bad times and bad confidence", () => {
    expect(llmTaskOutputSchema.safeParse({ ...valid, category: "crypto" }).success).toBe(false);
    expect(llmTaskOutputSchema.safeParse({ ...valid, dueDate: "2030-02-30" }).success).toBe(false);
    expect(llmTaskOutputSchema.safeParse({ ...valid, dueDate: "next Tuesday" }).success).toBe(
      false,
    );
    expect(llmTaskOutputSchema.safeParse({ ...valid, dueTime: "25:00" }).success).toBe(false);
    expect(llmTaskOutputSchema.safeParse({ ...valid, confidence: 1.2 }).success).toBe(false);
  });
  it("rejects extra keys such as an executable payment action", () => {
    expect(llmTaskOutputSchema.safeParse({ ...valid, executePayment: true }).success).toBe(false);
    expect(
      llmTaskOutputSchema.safeParse({ ...valid, action: { type: "pay", amount: 100 } }).success,
    ).toBe(false);
    expect(llmTaskOutputSchema.safeParse({ ...valid, status: "confirmed" }).success).toBe(false);
  });
  it("rejects wrong types", () => {
    expect(llmTaskOutputSchema.safeParse({ ...valid, title: 5 }).success).toBe(false);
    expect(llmTaskOutputSchema.safeParse({ ...valid, uncertainFields: ["salary"] }).success).toBe(
      false,
    );
  });
});

describe("LLM_TASK_JSON_SCHEMA", () => {
  it("lists exactly the properties of the Zod schema, all required, no extras", () => {
    const zodKeys = Object.keys(llmTaskOutputSchema.shape).sort();
    expect(Object.keys(LLM_TASK_JSON_SCHEMA.properties).sort()).toEqual(zodKeys);
    expect([...LLM_TASK_JSON_SCHEMA.required].sort()).toEqual(zodKeys);
    expect(LLM_TASK_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(LLM_TASK_JSON_SCHEMA.properties.uncertainFields.items.enum).toEqual([
      ...EXTRACTION_FIELDS,
    ]);
  });
});

describe("extractedTaskSchema", () => {
  const task = {
    title: "Pay bill",
    category: "payment",
    dueAt: "2030-01-05T09:00:00+09:00",
    dueDate: "2030-01-05",
    dueTime: "09:00",
    location: null,
    assigneeSuggestion: null,
    notes: null,
    confidence: 0.9,
    uncertainFields: [],
    riskLevel: "high",
    riskReasons: ["high_risk_category"],
    warnings: [],
    needsReview: false,
  };
  it("accepts ISO 8601 dates with offset and rejects other formats", () => {
    expect(extractedTaskSchema.safeParse(task).success).toBe(true);
    expect(extractedTaskSchema.safeParse({ ...task, dueAt: "2030-01-05 09:00" }).success).toBe(
      false,
    );
  });
  it("has no field that can carry a payment action", () => {
    expect(extractedTaskSchema.safeParse({ ...task, paymentAction: "transfer" }).success).toBe(
      false,
    );
  });
});

describe("draftTaskInputSchema", () => {
  const input = {
    noteId: id,
    extractionId: null,
    title: "Buy milk",
    category: "reminder",
    dueDate: null,
    dueTime: null,
    location: null,
    assigneeId: null,
    notes: null,
  };
  it("accepts a draft input", () => {
    expect(draftTaskInputSchema.safeParse(input).success).toBe(true);
    expect(DRAFT_STATUS).toBe("draft");
  });
  it("cannot set status, risk level or approver", () => {
    for (const extra of [
      { status: "confirmed" },
      { riskLevel: "low" },
      { risk_level: "low" },
      { approvedBy: id },
    ]) {
      expect(draftTaskInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });
  it("requires a title and a valid category", () => {
    expect(draftTaskInputSchema.safeParse({ ...input, title: "  " }).success).toBe(false);
    expect(draftTaskInputSchema.safeParse({ ...input, category: "loan" }).success).toBe(false);
  });
});
