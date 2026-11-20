import { z } from "zod";
import { localDate } from "@/lib/datetime";
import { RISK_LEVELS, TASK_CATEGORIES, TASK_STATUSES } from "@/lib/schemas/task";

export const DUE_FILTERS = ["overdue", "today", "week", "none"] as const;

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z
    .preprocess((v) => (v === "" || v === undefined ? undefined : v), schema.optional())
    .catch(undefined);

/** Board filters from the URL. Unknown values are ignored rather than rejected. */
export const boardFilterSchema = z.object({
  status: optional(z.enum([...TASK_STATUSES, "open"] as const)),
  assignee: optional(z.union([z.enum(["me", "none"]), z.string().uuid()])),
  category: optional(z.enum(TASK_CATEGORIES)),
  risk: optional(z.enum(RISK_LEVELS)),
  due: optional(z.enum(DUE_FILTERS)),
});
export type BoardFilters = z.infer<typeof boardFilterSchema>;

export function parseBoardFilters(
  params: Record<string, string | string[] | undefined>,
): BoardFilters {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  return boardFilterSchema.parse(flat);
}

interface FilterableTask {
  status: string;
  assignee_id: string | null;
  category: string;
  risk_level: string;
  due_at: string | null;
}

/** Applies board filters. "open" means draft, awaiting approval, or confirmed (the default view). */
export function filterTasks<T extends FilterableTask>(
  tasks: readonly T[],
  filters: BoardFilters,
  ctx: { memberId: string; now: Date; timeZone: string },
): T[] {
  const today = localDate(ctx.now, ctx.timeZone);
  const weekEnd = localDate(new Date(ctx.now.getTime() + 7 * 86_400_000), ctx.timeZone);
  const status = filters.status ?? "open";

  return tasks.filter((task) => {
    if (status === "open") {
      if (!["draft", "awaiting_confirmation", "confirmed"].includes(task.status)) return false;
    } else if (task.status !== status) return false;

    if (filters.assignee === "me" && task.assignee_id !== ctx.memberId) return false;
    if (filters.assignee === "none" && task.assignee_id !== null) return false;
    if (
      filters.assignee &&
      !["me", "none"].includes(filters.assignee) &&
      task.assignee_id !== filters.assignee
    ) {
      return false;
    }
    if (filters.category && task.category !== filters.category) return false;
    if (filters.risk && task.risk_level !== filters.risk) return false;

    if (filters.due) {
      if (filters.due === "none") return task.due_at === null;
      if (!task.due_at) return false;
      const day = localDate(new Date(task.due_at), ctx.timeZone);
      if (filters.due === "overdue") return new Date(task.due_at).getTime() < ctx.now.getTime();
      if (filters.due === "today") return day === today;
      if (filters.due === "week") return day >= today && day <= weekEnd;
    }
    return true;
  });
}
