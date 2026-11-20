import type { Metadata } from "next";
import Link from "next/link";
import { RiskBadge } from "@/components/RiskBadge";
import { SignInPrompt } from "@/components/SignInPrompt";
import { StatusBadge } from "@/components/StatusBadge";
import { TaskFilters } from "@/components/TaskFilters";
import { TaskQuickActions } from "@/components/TaskQuickActions";
import { linkClass, primaryButton } from "@/components/ui";
import { resolveTimeZone } from "@/lib/datetime";
import { formatDue } from "@/lib/format";
import { t } from "@/lib/i18n/messages";
import { filterTasks, parseBoardFilters } from "@/lib/workflow/board-filters";
import { availableActions } from "@/lib/workflow/transitions";
import { listMembers, listTasks } from "@/server/tasks/queries";
import { getSessionContext } from "@/server/session";

export const metadata: Metadata = { title: t.board.title };
export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionContext();
  if (session.status !== "ready") {
    return (
      <>
        <h1 className="text-4xl font-bold">{t.board.title}</h1>
        <SignInPrompt status={session.status} next="/board" />
      </>
    );
  }

  const filters = parseBoardFilters(await searchParams);
  const timeZone = resolveTimeZone(null, process.env.DEFAULT_TIMEZONE);
  const [tasks, members] = await Promise.all([
    listTasks(session.supabase, session.householdId),
    listMembers(session.supabase, session.householdId),
  ]);
  const names = new Map(members.map((m) => [m.id, m.display_name]));
  const shown = filterTasks(tasks, filters, {
    memberId: session.memberId,
    now: new Date(),
    timeZone,
  });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">{t.board.title}</h1>
          <p className="mt-2 text-lg text-ink-soft">{t.boardPage.intro}</p>
        </div>
        <Link href="/#add-note" className={primaryButton}>
          {t.boardPage.newNote}
        </Link>
      </div>

      <div className="mt-8">
        <TaskFilters filters={filters} members={members} />
      </div>

      <section aria-labelledby="results-title" className="mt-8">
        <h2 id="results-title" className="text-2xl font-semibold">
          {t.boardPage.results} <span className="text-ink-soft">({shown.length})</span>
        </h2>
        {shown.length === 0 ? (
          <p className="paper-card mt-4 p-6 text-lg">{t.boardPage.empty}</p>
        ) : (
          <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((task) => {
              const actions = availableActions({
                role: session.role,
                memberId: session.memberId,
                task: {
                  status: task.status,
                  riskLevel: task.risk_level,
                  assigneeId: task.assignee_id,
                },
              });
              return (
                <li key={task.id}>
                  <article
                    aria-labelledby={`task-${task.id}`}
                    className="paper-card flex h-full flex-col p-5"
                  >
                    <h3 id={`task-${task.id}`} className="text-2xl font-semibold">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="rounded text-ink underline-offset-4 hover:underline"
                      >
                        {task.title}
                      </Link>
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusBadge status={task.status} />
                      <RiskBadge level={task.risk_level} />
                    </div>
                    <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
                      <dt className="text-ink-soft">{t.detail.category}</dt>
                      <dd>{t.review.categories[task.category]}</dd>
                      <dt className="text-ink-soft">{t.boardPage.dueLabel}</dt>
                      <dd>{formatDue(task.due_at, timeZone, t.boardPage.noDue)}</dd>
                      <dt className="text-ink-soft">{t.boardPage.assignedTo}</dt>
                      <dd>
                        {(task.assignee_id && names.get(task.assignee_id)) || t.boardPage.nobody}
                      </dd>
                    </dl>
                    {task.note_id ? (
                      <p className="mt-3 text-lg">
                        <Link href={`/notes/${task.note_id}`} className={linkClass}>
                          <span aria-hidden="true">📝 </span>
                          {t.boardPage.hasNote}
                          <span className="sr-only">: {task.title}</span>
                        </Link>
                      </p>
                    ) : null}
                    <div className="mt-auto">
                      <TaskQuickActions
                        taskId={task.id}
                        taskTitle={task.title}
                        canClaim={actions.includes("claim")}
                        canAssign={actions.includes("assign")}
                        assigneeId={task.assignee_id}
                        members={members}
                      />
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
