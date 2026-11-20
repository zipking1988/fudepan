import { describe, expect, it } from "vitest";
import { PERMISSIONS, canApprove, hasPermission, isStaff } from "@/lib/permissions";

describe("role permissions", () => {
  it("elder can create notes, view tasks, and complete only tasks assigned to them", () => {
    expect(hasPermission("elder", "note.create")).toBe(true);
    expect(hasPermission("elder", "task.view")).toBe(true);
    expect(hasPermission("elder", "task.complete", { isAssignee: true })).toBe(true);
    expect(hasPermission("elder", "task.complete", { isAssignee: false })).toBe(false);
    expect(hasPermission("elder", "task.complete")).toBe(false);
  });

  it("elder cannot approve, reject, edit, claim, assign, cancel, draft, or manage members", () => {
    for (const p of [
      "task.approve",
      "task.reject",
      "task.edit",
      "task.claim",
      "task.assign",
      "task.cancel",
      "task.draft",
      "task.submit",
      "member.invite",
      "member.manage_roles",
    ] as const) {
      expect(hasPermission("elder", p)).toBe(false);
    }
    expect(canApprove("elder")).toBe(false);
  });

  it("caregiver can do every task action, including approving high-risk tasks, but not manage members", () => {
    for (const p of PERMISSIONS.filter((p) => p.startsWith("task.") || p === "note.create")) {
      expect(hasPermission("caregiver", p)).toBe(true);
    }
    expect(canApprove("caregiver")).toBe(true);
    expect(hasPermission("caregiver", "member.invite")).toBe(false);
    expect(hasPermission("caregiver", "member.manage_roles")).toBe(false);
  });

  it("coordinator can do everything", () => {
    for (const p of PERMISSIONS) expect(hasPermission("coordinator", p)).toBe(true);
    expect(isStaff("coordinator")).toBe(true);
    expect(isStaff("elder")).toBe(false);
  });
});
