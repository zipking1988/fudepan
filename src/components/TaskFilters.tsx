import Link from "next/link";
import { fieldClass, primaryButton, secondaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { RISK_LEVELS, TASK_CATEGORIES, TASK_STATUSES } from "@/lib/schemas/task";
import type { BoardFilters } from "@/lib/workflow/board-filters";

/** A plain GET form, so filters work without JavaScript and can be bookmarked. */
export function TaskFilters({
  filters,
  members,
}: {
  filters: BoardFilters;
  members: { id: string; display_name: string }[];
}) {
  const select = (
    id: string,
    label: string,
    value: string | undefined,
    options: [string, string][],
  ) => (
    <div>
      <label htmlFor={id} className="block text-lg font-semibold">
        {label}
      </label>
      <select
        id={id}
        name={id.replace("filter-", "")}
        defaultValue={value ?? ""}
        className={fieldClass}
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form
      method="get"
      action="/board"
      aria-labelledby="filters-title"
      className="paper-card p-4 sm:p-6"
    >
      <h2 id="filters-title" className="text-2xl font-semibold">
        {t.boardPage.filtersTitle}
      </h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {select("filter-status", t.boardPage.status, filters.status, [
          ["", t.boardPage.openTasks],
          ...TASK_STATUSES.map((s) => [s, t.workflow.status[s]] as [string, string]),
        ])}
        {select("filter-assignee", t.boardPage.assignee, filters.assignee, [
          ["", t.boardPage.any],
          ["me", t.boardPage.mine],
          ["none", t.boardPage.nobody],
          ...members.map((m) => [m.id, m.display_name] as [string, string]),
        ])}
        {select("filter-category", t.boardPage.category, filters.category, [
          ["", t.boardPage.any],
          ...TASK_CATEGORIES.map((c) => [c, t.review.categories[c]] as [string, string]),
        ])}
        {select("filter-risk", t.boardPage.risk, filters.risk, [
          ["", t.boardPage.any],
          ...RISK_LEVELS.map((r) => [r, t.risk[r]] as [string, string]),
        ])}
        {select("filter-due", t.boardPage.due, filters.due, [
          ["", t.boardPage.any],
          ["overdue", t.boardPage.dueOverdue],
          ["today", t.boardPage.dueToday],
          ["week", t.boardPage.dueWeek],
          ["none", t.boardPage.dueNone],
        ])}
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" className={primaryButton}>
          {t.boardPage.apply}
        </button>
        <Link href="/board" className={secondaryButton}>
          {t.boardPage.clear}
        </Link>
      </div>
    </form>
  );
}
