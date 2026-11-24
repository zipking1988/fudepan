import type { MemberRecord } from "./rules";

export type MemberRowAction = "change_role" | "remove" | "edit_name" | "leave";

/**
 * Buttons the Members_Page shows on one row. A Family_Member is an active member whose Role is not
 * care_recipient (Care_Recipients never see the page). Same household only.
 */
export function memberActionsFor(viewer: MemberRecord, target: MemberRecord): MemberRowAction[] {
  if (!viewer.isActive || viewer.householdId !== target.householdId) return [];
  if (target.id === viewer.id) {
    return viewer.role === "care_recipient" ? [] : ["edit_name", "leave"];
  }
  if (viewer.role === "primary_caregiver" && target.isActive) return ["change_role", "remove"];
  return [];
}
