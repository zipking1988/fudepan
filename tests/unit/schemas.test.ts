import { describe, expect, it } from "vitest";
import {
  auditEventInputSchema,
  noteInputSchema,
  parsedTaskSchema,
  taskUpdateSchema,
  HIGH_RISK_CATEGORIES,
  TASK_CATEGORIES,
} from "@/lib/schemas";

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";

describe("noteInputSchema", () => {
  it("accepts pasted text", () => {
    expect(
      noteInputSchema.safeParse({ householdId: id, sourceType: "text", textContent: " Buy milk " })
        .success,
    ).toBe(true);
  });
  it("rejects empty text", () => {
    expect(
      noteInputSchema.safeParse({ householdId: id, sourceType: "text", textContent: "  " }).success,
    ).toBe(false);
  });
  it("accepts JPG, PNG and HEIC but rejects other types", () => {
    for (const m of ["image/jpeg", "image/png", "image/heic"]) {
      expect(
        noteInputSchema.safeParse({
          householdId: id,
          sourceType: "image",
          imageMimeType: m,
          imageSizeBytes: 1000,
        }).success,
      ).toBe(true);
    }
    expect(
      noteInputSchema.safeParse({
        householdId: id,
        sourceType: "image",
        imageMimeType: "application/pdf",
        imageSizeBytes: 1000,
      }).success,
    ).toBe(false);
  });
  it("rejects images over 10 MB", () => {
    expect(
      noteInputSchema.safeParse({
        householdId: id,
        sourceType: "image",
        imageMimeType: "image/png",
        imageSizeBytes: 11 * 1024 * 1024,
      }).success,
    ).toBe(false);
  });
});

describe("parsedTaskSchema", () => {
  const valid = {
    title: "Pick up prescription",
    category: "medication",
    dueAt: "2030-01-01T09:00:00+09:00",
    location: null,
    assigneeSuggestion: null,
    notes: null,
    confidence: 0.8,
    needsReview: false,
  };
  it("accepts a valid task", () => {
    expect(parsedTaskSchema.safeParse(valid).success).toBe(true);
  });
  it("rejects unknown categories and non-ISO dates", () => {
    expect(parsedTaskSchema.safeParse({ ...valid, category: "crypto" }).success).toBe(false);
    expect(parsedTaskSchema.safeParse({ ...valid, dueAt: "next Tuesday" }).success).toBe(false);
  });
  it("rejects confidence outside 0..1", () => {
    expect(parsedTaskSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
  });
  it("lists the four high-risk categories", () => {
    expect([...HIGH_RISK_CATEGORIES].sort()).toEqual([
      "appointment",
      "medication",
      "payment",
      "pickup",
    ]);
    expect(TASK_CATEGORIES).toHaveLength(6);
  });
});

describe("taskUpdateSchema", () => {
  it("accepts partial edits", () => {
    expect(taskUpdateSchema.safeParse({ title: "New title" }).success).toBe(true);
  });
  it("rejects empty updates", () => {
    expect(taskUpdateSchema.safeParse({}).success).toBe(false);
  });
  it("rejects attempts to set status, risk, or approver", () => {
    expect(taskUpdateSchema.safeParse({ status: "confirmed" }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ riskLevel: "low" }).success).toBe(false);
    expect(taskUpdateSchema.safeParse({ approvedBy: id }).success).toBe(false);
  });
});

describe("auditEventInputSchema", () => {
  const base = { householdId: id, taskId: id2, actorId: id, eventType: "task_updated" };
  it("accepts a valid event and defaults payload", () => {
    const r = auditEventInputSchema.safeParse(base);
    expect(r.success && r.data.payload).toEqual({});
  });
  it("rejects unknown event types", () => {
    expect(auditEventInputSchema.safeParse({ ...base, eventType: "task_deleted" }).success).toBe(
      false,
    );
  });
  it("requires a task or note reference", () => {
    expect(auditEventInputSchema.safeParse({ ...base, taskId: null }).success).toBe(false);
  });
});
