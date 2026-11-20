import { z } from "zod";

export const ROLES = ["elder", "caregiver", "coordinator"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const PERMISSIONS = [
  "note.create",
  "task.view",
  "task.draft",
  "task.edit",
  "task.claim",
  "task.assign",
  "task.submit",
  "task.approve",
  "task.reject",
  "task.cancel",
  "task.complete",
  "member.invite",
  "member.manage_roles",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Caregivers and coordinators review, approve and manage tasks. */
export function isStaff(role: Role): boolean {
  return role === "caregiver" || role === "coordinator";
}

/**
 * Role permission rules (the database enforces the same rules):
 * - elder: create notes, view tasks, complete tasks assigned to them.
 * - caregiver: everything about tasks, including approving high-risk tasks.
 * - coordinator: everything a caregiver can do, plus invitations and roles.
 */
export function hasPermission(
  role: Role,
  permission: Permission,
  context: { isAssignee?: boolean } = {},
): boolean {
  switch (permission) {
    case "note.create":
    case "task.view":
      return true;
    case "task.complete":
      return isStaff(role) || (role === "elder" && context.isAssignee === true);
    case "member.invite":
    case "member.manage_roles":
      return role === "coordinator";
    default:
      return isStaff(role);
  }
}

/** Only a caregiver or coordinator can approve, whatever the risk level. */
export function canApprove(role: Role): boolean {
  return hasPermission(role, "task.approve");
}
