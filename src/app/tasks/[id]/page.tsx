import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { CalendarExport } from "@/components/CalendarExport";
import { OriginalNotePanel } from "@/components/OriginalNotePanel";
import { RiskBadge } from "@/components/RiskBadge";
import { SignInPrompt } from "@/components/SignInPrompt";
import { StatusBadge } from "@/components/StatusBadge";
import { TaskActions } from "@/components/TaskActions";
import { TaskEditForm } from "@/components/TaskEditForm";
import { Timeline } from "@/components/Timeline";
import { linkClass } from "@/components/ui";
import { localDate, localTime, resolveTimeZone } from "@/lib/datetime";
import { formatDue } from "@/lib/format";
import { t } from "@/lib/i18n/messages";
import { maskSensitive } from "@/lib/safety/mask-sensitive";
import { buildTimeline, type TimelineSourceEvent } from "@/lib/workflow/timeline";
import { availableActions } from "@/lib/workflow/transitions";
import { loadNote } from "@/server/notes/load-note";
import { getTask, listMembers } from "@/server/tasks/queries";
import { getSessionContext } from "@/server/session";

export const metadata: Metadata = { title: t.task.title };
export const dynamic = "force-dynamic";

const mask = (v: string | null) => (v ? maskSensitive(v).text : null);

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const heading = <h1 className="text-4xl font-bold">{t.task.title}</h1>;

  if (!z.string().uuid().safeParse(id).success) {
    return (
      <>
        {heading}
        <p className="paper-card mt-6 p-6 text-lg">{t.detail.notFound}</p>
      </>
    );
  }

  const session = await getSessionContext();
  if (session.status !== "ready") {
    return (
      <>
        {heading}
        <SignInPrompt status={session.status} next={`/tasks/${id}`} />
      </>
    );
  }

  // RLS returns nothing for tasks outside the user's households.
  const task = await getTask(session.supabase, id);
  const membership = task && session.memberships.find((m) => m.householdId === task.household_id);
  if (!task || !membership) {
    return (
      <>
        {heading}
        <p className="paper-card mt-6 p-6 text-lg">{t.detail.notFound}</p>
      </>
    );
  }

  const timeZone = resolveTimeZone(null, process.env.DEFAULT_TIMEZONE);
  const [members, note, taskEvents, noteEvents] = await Promise.all([
    listMembers(session.supabase, task.household_id),
    task.note_id ? loadNote(session.supabase, task.note_id) : Promise.resolve(null),
    session.supabase
      .from("audit_events")
      .select("id, event_type, actor_id, payload, created_at")
      .eq("task_id", task.id)
      .order("created_at", { ascending: true }),
    task.note_id
      ? session.supabase
          .from("audit_events")
          .select("id, event_type, actor_id, payload, created_at")
          .eq("note_id", task.note_id)
          .is("task_id", null)
          .in("event_type", ["note_created", "task_extracted"])
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  const names = new Map(members.map((m) => [m.user_id, m.display_name]));
  const memberNames = new Map(members.map((m) => [m.id, m.display_name]));
  const timeline = buildTimeline(
    [
      ...((noteEvents.data ?? []) as TimelineSourceEvent[]),
      ...((taskEvents.data ?? []) as TimelineSourceEvent[]),
    ],
    names,
  );
  const actions = availableActions({
    role: membership.role,
    memberId: membership.memberId,
    task: { status: task.status, riskLevel: task.risk_level, assigneeId: task.assignee_id },
  });

  const title = mask(task.title) ?? "";
  const location = mask(task.location);
  const notes = mask(task.notes);
  const dueDate = task.due_at ? new Date(task.due_at) : null;

  return (
    <>
      <p>
        <Link href="/board" className={`${linkClass} inline-flex min-h-11 items-center text-lg`}>
          <span aria-hidden="true">← </span>
          {t.nav.board}
        </Link>
      </p>
      {heading}
      <p className="mt-2 text-3xl font-[family-name:var(--font-display)]" data-testid="task-title">
        {title}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <StatusBadge status={task.status} />
        <RiskBadge level={task.risk_level} />
      </div>
      {task.needs_review ? (
        <p className="mt-4 flex max-w-3xl gap-2 rounded-md bg-amber-50 px-3 py-2 text-lg text-amber">
          <span aria-hidden="true">⚠</span>
          {t.detail.needsReview}
        </p>
      ) : null}

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="grid content-start gap-6">
          {note ? (
            <OriginalNotePanel
              sourceType={note.sourceType}
              imageUrl={note.imageUrl}
              text={note.text}
              ocrConfidence={note.ocrConfidence}
            />
          ) : null}
        </div>

        <div className="grid content-start gap-6">
          <section aria-labelledby="fields-title" className="paper-card p-4 sm:p-6">
            <h2 id="fields-title" className="text-2xl font-semibold">
              {t.detail.fields}
            </h2>
            <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-lg sm:grid-cols-[auto_1fr]">
              <dt className="font-semibold text-ink-soft">{t.detail.status}</dt>
              <dd>{t.workflow.status[task.status]}</dd>
              <dt className="font-semibold text-ink-soft">{t.detail.risk}</dt>
              <dd>{t.risk[task.risk_level]}</dd>
              <dt className="font-semibold text-ink-soft">{t.detail.category}</dt>
              <dd>{t.review.categories[task.category]}</dd>
              <dt className="font-semibold text-ink-soft">{t.detail.due}</dt>
              <dd>{formatDue(task.due_at, timeZone, t.detail.none)}</dd>
              <dt className="font-semibold text-ink-soft">{t.detail.location}</dt>
              <dd>{location ?? t.detail.none}</dd>
              <dt className="font-semibold text-ink-soft">{t.detail.assignee}</dt>
              <dd>
                {(task.assignee_id && memberNames.get(task.assignee_id)) || t.boardPage.nobody}
              </dd>
              <dt className="font-semibold text-ink-soft">{t.detail.notes}</dt>
              <dd className="whitespace-pre-wrap">{notes ?? t.detail.none}</dd>
            </dl>
          </section>

          <TaskActions
            taskId={task.id}
            actions={actions}
            risk={task.risk_level}
            category={task.category}
            assigneeId={task.assignee_id}
            members={members}
            waitingForApproval={task.status === "awaiting_confirmation"}
          />

          {actions.includes("edit") ? (
            <TaskEditForm
              taskId={task.id}
              timeZone={timeZone}
              members={members}
              noteText={note?.text ?? ""}
              initial={{
                title,
                category: task.category,
                dueDate: dueDate ? localDate(dueDate, timeZone) : "",
                dueTime: dueDate ? localTime(dueDate, timeZone) : "",
                location: location ?? "",
                assigneeId: task.assignee_id ?? "",
                notes: notes ?? "",
              }}
            />
          ) : task.status === "confirmed" ? (
            <p className="text-lg text-ink-soft">{t.workflow.editLocked}</p>
          ) : null}

          <CalendarExport taskId={task.id} status={task.status} hasDueDate={task.due_at !== null} />

          <Timeline entries={timeline} timeZone={timeZone} />
        </div>
      </div>
    </>
  );
}
