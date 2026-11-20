import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RiskLevel, TaskCategory, TaskStatus } from "@/lib/schemas/task";

export interface TaskRow {
  id: string;
  household_id: string;
  note_id: string | null;
  title: string;
  category: TaskCategory;
  risk_level: RiskLevel;
  status: TaskStatus;
  due_at: string | null;
  location: string | null;
  assignee_id: string | null;
  approved_by: string | null;
  notes: string | null;
  needs_review: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemberRow {
  id: string;
  user_id: string;
  display_name: string;
  role: string;
}

const TASK_COLUMNS =
  "id, household_id, note_id, title, category, risk_level, status, due_at, location, assignee_id, approved_by, notes, needs_review, created_at, updated_at";

/** Reads go through the user's RLS-bound client. The household filter picks the active one. */
export async function listTasks(supabase: SupabaseClient, householdId: string): Promise<TaskRow[]> {
  const { data } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("household_id", householdId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(300);
  return (data ?? []) as TaskRow[];
}

export async function getTask(supabase: SupabaseClient, id: string): Promise<TaskRow | null> {
  const { data } = await supabase.from("tasks").select(TASK_COLUMNS).eq("id", id).maybeSingle();
  return (data as TaskRow | null) ?? null;
}

export async function listMembers(
  supabase: SupabaseClient,
  householdId: string,
): Promise<MemberRow[]> {
  const { data } = await supabase
    .from("members")
    .select("id, user_id, display_name, role")
    .eq("household_id", householdId)
    .order("display_name", { ascending: true });
  return (data ?? []) as MemberRow[];
}
