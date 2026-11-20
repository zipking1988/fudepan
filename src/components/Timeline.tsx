import { formatTimestamp } from "@/lib/format";
import { t } from "@/lib/i18n/messages";
import type { TimelineEntry } from "@/lib/workflow/timeline";

export function Timeline({ entries, timeZone }: { entries: TimelineEntry[]; timeZone: string }) {
  return (
    <section aria-labelledby="timeline-title" className="paper-card p-4 sm:p-6">
      <h2 id="timeline-title" className="text-2xl font-semibold">
        {t.detail.timeline}
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-lg">{t.detail.timelineEmpty}</p>
      ) : (
        <ol className="mt-4 grid gap-4 border-l-4 border-sage-100 pl-5">
          {entries.map((e) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[1.85rem] top-2 h-3 w-3 rounded-full bg-sage-600"
              />
              <p className="text-lg font-semibold">{e.text}</p>
              <p className="text-lg text-ink-soft">
                <time dateTime={e.at}>{formatTimestamp(e.at, timeZone)}</time>
              </p>
              {e.details.length > 0 ? (
                <ul className="mt-1 text-lg text-ink-soft">
                  {e.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
