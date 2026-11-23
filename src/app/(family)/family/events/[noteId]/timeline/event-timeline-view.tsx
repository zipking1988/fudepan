import Link from "next/link";

import { LocalDateTime } from "@/components/app/local-date-time";
import type { TimelineEntry } from "@/lib/care/timeline";
import type { Language } from "@/lib/i18n/format";
import { createTranslator, isMessageKey, type MessageKey } from "@/lib/i18n/messages";

const ROLE_KEYS: Record<string, MessageKey> = {
  owner: "role.owner",
  driver: "role.driver",
  companion: "role.companion",
  backup: "role.backup",
};

/** Extra facts for an entry. Every word comes from the dictionary; params only fill slots. */
function detailLines(entry: TimelineEntry, tr: ReturnType<typeof createTranslator>): string[] {
  const lines: string[] = [];
  const role = entry.params.role;
  if (typeof role === "string" && ROLE_KEYS[role]) {
    lines.push(tr.t("timeline.detail.role", { role: tr.t(ROLE_KEYS[role]) }));
  }
  const count = entry.params.missing_count ?? entry.params.evidence_count;
  if (typeof count === "number") lines.push(tr.t("timeline.detail.count", { count }));
  const zone = entry.params.timezone;
  if (typeof zone === "string") lines.push(tr.t("timeline.detail.zone", { zone }));
  return lines;
}

function actorText(entry: TimelineEntry, tr: ReturnType<typeof createTranslator>): string {
  if (entry.actorType === "human") return entry.actorName ?? tr.t("timeline.actor.member");
  return tr.t("timeline.actor.system");
}

export function EventTimelineView({
  entries,
  language,
  eventHref,
}: {
  entries: readonly TimelineEntry[];
  language: Language;
  eventHref: string;
}) {
  const tr = createTranslator(language);
  return (
    <>
      <p>
        <Link href={eventHref} className="app-link">
          {tr.t("timeline.back")}
        </Link>
      </p>
      <h1 className="app-title">{tr.t("timeline.title")}</h1>
      {entries.length === 0 ? (
        <p className="app-lede">{tr.t("timeline.empty")}</p>
      ) : (
        <ol aria-label={tr.t("timeline.listLabel")} className="mt-6 space-y-4">
          {entries.map((entry) => {
            const label = isMessageKey(entry.labelKey)
              ? tr.t(entry.labelKey)
              : tr.t("timeline.unknown_event");
            const details = detailLines(entry, tr);
            return (
              <li key={entry.id} className="rounded-lg border border-current/20 p-4 text-lg">
                <p className="font-semibold">{label}</p>
                <p>
                  {actorText(entry, tr)} · <LocalDateTime iso={entry.at} lang={tr.lang} />
                </p>
                {entry.stepTitle ? <p>{tr.t("timeline.forPart", { title: entry.stepTitle })}</p> : null}
                {details.map((d) => (
                  <p key={d}>{d}</p>
                ))}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
