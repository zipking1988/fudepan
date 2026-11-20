import { describe, expect, it } from "vitest";
import { TASK_STATUSES, RISK_LEVELS } from "@/lib/schemas/task";
import {
  ACTION_EVENT_TYPE,
  TASK_ACTIONS,
  availableActions,
  canConfirmFrom,
  checkTaskAction,
  isAllowedTransition,
  type ActionContext,
} from "@/lib/workflow/transitions";

const ctx = (
  over: Partial<ActionContext["task"]> = {},
  role: ActionContext["role"] = "caregiver",
): ActionContext => ({
  role,
  memberId: "m-self",
  task: { status: "draft", riskLevel: "high", assigneeId: null, ...over },
});

describe("status transitions", () => {
  it("allows only the documented transitions", () => {
    const allowed = new Set([
      "draft>awaiting_confirmation",
      "draft>confirmed",
      "draft>cancelled",
      "awaiting_confirmation>confirmed",
      "awaiting_confirmation>rejected",
      "awaiting_confirmation>cancelled",
      "confirmed>completed",
      "confirmed>cancelled",
    ]);
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        expect(isAllowedTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it("closed tasks cannot change status", () => {
    for (const from of ["completed", "cancelled", "rejected"] as const) {
      for (const to of TASK_STATUSES) expect(isAllowedTransition(from, to)).toBe(false);
    }
  });
});

describe("high-risk approval rules", () => {
  it("a high or medium risk draft can never be confirmed directly", () => {
    expect(canConfirmFrom("draft", "high")).toBe(false);
    expect(canConfirmFrom("draft", "medium")).toBe(false);
    expect(checkTaskAction("approve", ctx({ status: "draft", riskLevel: "high" }))).toEqual({
      ok: false,
      reason: "invalid_state",
    });
    expect(checkTaskAction("approve", ctx({ status: "draft", riskLevel: "medium" }))).toEqual({
      ok: false,
      reason: "invalid_state",
    });
  });

  it("only a low-risk draft can skip the approval queue", () => {
    expect(canConfirmFrom("draft", "low")).toBe(true);
    expect(checkTaskAction("approve", ctx({ status: "draft", riskLevel: "low" }))).toEqual({
      ok: true,
      toStatus: "confirmed",
    });
  });

  it("a task awaiting confirmation can be approved by a caregiver or coordinator at any risk level", () => {
    for (const riskLevel of RISK_LEVELS) {
      for (const role of ["caregiver", "coordinator"] as const) {
        expect(
          checkTaskAction("approve", ctx({ status: "awaiting_confirmation", riskLevel }, role)),
        ).toEqual({ ok: true, toStatus: "confirmed" });
      }
    }
  });

  it("an elder can never approve or reject, even when assigned", () => {
    for (const status of TASK_STATUSES) {
      for (const riskLevel of RISK_LEVELS) {
        const c = ctx({ status, riskLevel, assigneeId: "m-self" }, "elder");
        expect(checkTaskAction("approve", c).ok).toBe(false);
        expect(checkTaskAction("reject", c).ok).toBe(false);
      }
    }
    expect(checkTaskAction("approve", ctx({ status: "awaiting_confirmation" }, "elder"))).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("submit moves a draft to awaiting_confirmation; reject only from awaiting", () => {
    expect(checkTaskAction("submit", ctx())).toEqual({
      ok: true,
      toStatus: "awaiting_confirmation",
    });
    expect(checkTaskAction("submit", ctx({ status: "awaiting_confirmation" })).ok).toBe(false);
    expect(checkTaskAction("reject", ctx({ status: "awaiting_confirmation" }))).toEqual({
      ok: true,
      toStatus: "rejected",
    });
    expect(checkTaskAction("reject", ctx({ status: "draft" })).ok).toBe(false);
    expect(checkTaskAction("approve", ctx({ status: "confirmed" })).ok).toBe(false);
  });
});

describe("other actions", () => {
  it("claim only when unassigned and open", () => {
    expect(checkTaskAction("claim", ctx()).ok).toBe(true);
    expect(checkTaskAction("claim", ctx({ assigneeId: "m-other" })).ok).toBe(false);
    expect(checkTaskAction("claim", ctx({ status: "completed" })).ok).toBe(false);
    expect(checkTaskAction("claim", ctx({}, "elder"))).toEqual({ ok: false, reason: "forbidden" });
  });

  it("complete only confirmed tasks; elders only their own", () => {
    expect(checkTaskAction("complete", ctx({ status: "awaiting_confirmation" })).ok).toBe(false);
    expect(checkTaskAction("complete", ctx({ status: "confirmed" })).ok).toBe(true);
    expect(
      checkTaskAction("complete", ctx({ status: "confirmed", assigneeId: "m-self" }, "elder")).ok,
    ).toBe(true);
    expect(
      checkTaskAction("complete", ctx({ status: "confirmed", assigneeId: "m-other" }, "elder")),
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(
      checkTaskAction("complete", ctx({ status: "confirmed", assigneeId: null }, "elder")).ok,
    ).toBe(false);
  });

  it("edit only drafts and tasks awaiting approval, never confirmed or closed ones", () => {
    expect(checkTaskAction("edit", ctx({ status: "draft" })).ok).toBe(true);
    expect(checkTaskAction("edit", ctx({ status: "awaiting_confirmation" })).ok).toBe(true);
    for (const status of ["confirmed", "completed", "cancelled", "rejected"] as const) {
      expect(checkTaskAction("edit", ctx({ status })).ok).toBe(false);
    }
  });

  it("cancel any open task, never a closed one", () => {
    for (const status of ["draft", "awaiting_confirmation", "confirmed"] as const)
      expect(checkTaskAction("cancel", ctx({ status })).ok).toBe(true);
    for (const status of ["completed", "cancelled", "rejected"] as const)
      expect(checkTaskAction("cancel", ctx({ status })).ok).toBe(false);
  });

  it("availableActions lists what the buttons should offer", () => {
    expect(availableActions(ctx({ status: "draft", riskLevel: "high" }))).toEqual([
      "claim",
      "assign",
      "edit",
      "submit",
      "cancel",
    ]);
    expect(availableActions(ctx({ status: "awaiting_confirmation", assigneeId: "x" }))).toEqual([
      "assign",
      "edit",
      "approve",
      "reject",
      "cancel",
    ]);
    expect(availableActions(ctx({ status: "awaiting_confirmation" }, "elder"))).toEqual([]);
    expect(availableActions(ctx({ status: "confirmed", assigneeId: "m-self" }, "elder"))).toEqual([
      "complete",
    ]);
  });

  it("every action maps to an audit event type", () => {
    for (const a of TASK_ACTIONS) expect(ACTION_EVENT_TYPE[a]).toBeTruthy();
    expect(ACTION_EVENT_TYPE.approve).toBe("task_approved");
    expect(ACTION_EVENT_TYPE.reject).toBe("task_rejected");
    expect(ACTION_EVENT_TYPE.complete).toBe("task_completed");
    expect(ACTION_EVENT_TYPE.cancel).toBe("task_cancelled");
    expect(ACTION_EVENT_TYPE.submit).toBe("task_confirmation_requested");
    expect(ACTION_EVENT_TYPE.claim).toBe("task_updated");
  });
});
