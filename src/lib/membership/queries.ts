import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalState } from "@/lib/care/rules/types";
import { isHouseholdRole, type HouseholdRole } from "@/lib/households/membership";
import type { Database } from "@/lib/supabase/database.types";
import { MEMBERSHIP_EVENT_TYPES } from "./audit-payload";
import { heldParts, type HeldPart, type PartHolders, type RequestRef } from "./held-parts";
import { listInvites as listInvitesViaService, type InviteListItem, type ServiceResult } from "./service";

type Client = SupabaseClient<Database>;

export type MemberListItem = {
  id: string;
  userId: string;
  displayName: string;
  role: HouseholdRole;
  isActive: boolean;
  createdAt: string;
};

/** Members of one household through the person's own RLS client. Never reads `auth.users`, so no email appears. */
export async function listMembers(supabase: Client, householdId: string): Promise<MemberListItem[]> {
  const { data, error } = await supabase
    .from("household_members")
    .select("id, user_id, display_name, role, is_active, created_at")
    .eq("household_id", householdId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error("member_query_failed");
  return data.flatMap((m) =>
    isHouseholdRole(m.role)
      ? [
          {
            id: m.id,
            userId: m.user_id,
            displayName: m.display_name,
            role: m.role,
            isActive: m.is_active,
            createdAt: m.created_at,
          },
        ]
      : [],
  );
}

const CLOSED = new Set(["completed", "cancelled", "failed"]);
const APPROVAL: readonly ApprovalState[] = ["not_required", "pending", "approved", "rejected"];
const HIGH_RISK_CATEGORIES = new Set(["appointment", "medication", "payment", "transport", "document"]);
const STEP_COLUMNS =
  "id, title, status, risk_level, care_category, approval_state, owner_id, driver_id, companion_id, backup_owner_id, care_chains!inner ( household_id )";

/** Open Parts that one member holds or has a pending request on, for the removal and leave confirmations. */
export async function listHeldParts(supabase: Client, householdId: string, memberId: string): Promise<HeldPart[]> {
  const [held, requests] = await Promise.all([
    supabase
      .from("care_steps")
      .select(STEP_COLUMNS)
      .eq("care_chains.household_id", householdId)
      .or(
        ["owner_id", "driver_id", "companion_id", "backup_owner_id"].map((c) => `${c}.eq.${memberId}`).join(","),
      ),
    supabase
      .from("care_requests")
      .select("id, care_step_id, from_member_id, to_member_id, status")
      .eq("household_id", householdId)
      .eq("status", "pending")
      .or(`from_member_id.eq.${memberId},to_member_id.eq.${memberId}`),
  ]);
  if (held.error || requests.error) throw new Error("held_parts_query_failed");

  const refs: RequestRef[] = requests.data.map((r) => ({
    id: r.id,
    partId: r.care_step_id,
    fromId: r.from_member_id,
    toId: r.to_member_id,
    status: "pending",
  }));
  const rows = new Map(held.data.map((s) => [s.id, s]));
  const missing = [...new Set(refs.map((r) => r.partId))].filter((id) => !rows.has(id));
  if (missing.length > 0) {
    const extra = await supabase
      .from("care_steps")
      .select(STEP_COLUMNS)
      .eq("care_chains.household_id", householdId)
      .in("id", missing);
    if (extra.error) throw new Error("held_parts_query_failed");
    for (const s of extra.data) rows.set(s.id, s);
  }
  const parts: PartHolders[] = [...rows.values()].map((s) => ({
    partId: s.id,
    title: s.title,
    isOpen: !CLOSED.has(s.status),
    ownerId: s.owner_id,
    driverId: s.driver_id,
    companionId: s.companion_id,
    backupOwnerId: s.backup_owner_id,
    isHighRisk: s.risk_level === "high" || HIGH_RISK_CATEGORIES.has(s.care_category),
    approvalState: APPROVAL.find((a) => a === s.approval_state) ?? "not_required",
  }));
  return heldParts(memberId, parts, refs);
}

export type MembershipAuditItem = {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
};

/** The 50 newest membership audit events of a household. RLS limits them to the person's own household. */
export async function listMembershipAudit(supabase: Client, householdId: string): Promise<MembershipAuditItem[]> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, event_type, actor_type, actor_id, created_at, payload")
    .eq("household_id", householdId)
    .in("event_type", [...MEMBERSHIP_EVENT_TYPES])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw new Error("membership_audit_query_failed");
  return data.map((e) => ({
    id: e.id,
    eventType: e.event_type,
    actorType: e.actor_type,
    actorId: e.actor_id,
    createdAt: e.created_at,
    payload: e.payload && typeof e.payload === "object" && !Array.isArray(e.payload) ? (e.payload as Record<string, unknown>) : {},
  }));
}

/** Invites have no client grants, so they are read through the guarded function (primary caregivers only). */
export function listInvites(input: { householdId: string; userId: string }): Promise<ServiceResult<InviteListItem[]>> {
  return listInvitesViaService(input);
}
