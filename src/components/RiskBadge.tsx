import type { RiskLevel } from "@/lib/schemas/task";
import { t } from "@/lib/i18n/messages";

const icons: Record<RiskLevel, string> = { low: "✓", medium: "!", high: "⚠" };
const styles: Record<RiskLevel, string> = {
  low: "border-green-800 bg-green-50 text-green-900",
  medium: "border-amber-800 bg-amber-50 text-amber-900",
  high: "border-red-800 bg-red-50 text-danger",
};

/** Risk is shown with an icon and a text label, never by color alone. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-2 rounded-full border-2 px-3 text-lg font-semibold ${styles[level]}`}
    >
      <span aria-hidden="true">{icons[level]}</span>
      {t.risk[level]}
    </span>
  );
}
