import type { TaskStatus } from "@/lib/schemas/task";
import { t } from "@/lib/i18n/messages";

const icons: Record<TaskStatus, string> = {
  draft: "✎",
  awaiting_confirmation: "⏳",
  confirmed: "✓",
  completed: "✔",
  cancelled: "✕",
  rejected: "✕",
};
const styles: Record<TaskStatus, string> = {
  draft: "border-edge bg-paper-shade text-ink",
  awaiting_confirmation: "border-amber-800 bg-amber-50 text-amber-950",
  confirmed: "border-sage-800 bg-sage-50 text-sage-900",
  completed: "border-green-800 bg-green-50 text-green-900",
  cancelled: "border-edge bg-paper-shade text-ink",
  rejected: "border-red-800 bg-red-50 text-danger",
};

/** Status is shown with an icon and text, never by color alone. */
export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-2 rounded-full border-2 px-3 text-lg font-semibold ${styles[status]}`}
    >
      <span aria-hidden="true">{icons[status]}</span>
      {t.workflow.status[status]}
    </span>
  );
}
