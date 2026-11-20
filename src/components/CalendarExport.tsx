import { secondaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import type { TaskStatus } from "@/lib/schemas/task";

/**
 * "Add to calendar" for approved tasks. A plain form post: the browser downloads an .ics file that
 * the person opens in their own calendar app. Fudepan does not connect to any calendar account.
 */
export function CalendarExport({
  taskId,
  status,
  hasDueDate,
}: {
  taskId: string;
  status: TaskStatus;
  hasDueDate: boolean;
}) {
  if (status !== "confirmed") return null;
  return (
    <section aria-labelledby="calendar-title" className="paper-card p-4 sm:p-6">
      <h2 id="calendar-title" className="text-2xl font-semibold">
        {t.calendar.title}
      </h2>
      {hasDueDate ? (
        <>
          <p id="calendar-help" className="mt-2 text-lg text-ink-soft">
            {t.calendar.help}
          </p>
          <form method="post" action={`/api/tasks/${taskId}/calendar`} className="mt-4">
            <button type="submit" aria-describedby="calendar-help" className={secondaryButton}>
              <span aria-hidden="true">📅&nbsp;</span>
              {t.calendar.button}
            </button>
          </form>
        </>
      ) : (
        <p className="mt-2 text-lg">{t.calendar.noDueDate}</p>
      )}
    </section>
  );
}
