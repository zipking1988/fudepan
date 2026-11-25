import Link from "next/link";
import type { ReactNode } from "react";
import { noteRow, type NoteRow } from "@/lib/family/notes-list";
import { withHonorific } from "@/lib/family/names";
import { notesTally } from "@/lib/family/notes-tally";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import { LocalTime } from "./local-time";
import { NoteRowLink } from "./note-row-link";
import { DemoResetButton } from "./demo-reset-button";
import { Icon } from "./playful/ui";
import "./notes-index.css";
const STATUS_ICON = {
  reading: "refresh",
  needsReview: "note",
  done: "check",
  failed: "note",
} as const;
/**
 * The household Notes index: one upload button, a quiet list of notes that each open their board,
 * and a contribution area (viewer's finished tasks, family thank-you board). The counts cover only
 * the notes passed in, and say so.
 */
export function NotesList({
  events,
  language,
  missingNote = false,
  updates = null,
  viewerId = "",
  recipientName = null,
  isDemo = false,
}: {
  events: readonly SharedCareEvent[];
  language: Language;
  missingNote?: boolean;
  /** The compact updates disclosure, already built by the page. */
  updates?: ReactNode;
  viewerId?: string;
  recipientName?: string | null;
  /** Shows a demo banner at the top when true. */
  isDemo?: boolean;
}) {
  const tr = createTranslator(language);
  const rows: NoteRow[] = events.map(noteRow);
  const tally = notesTally(events, viewerId);
  const target = recipientName
    ? tr.t("pb.mine.forName", { name: withHonorific(recipientName, tr) })
    : tr.t("pb.mine.forFamily");
  return (
    <div className="nx">
      <header className="nx-head">
        <div className="nx-head__text">
          <h1 className="nx-title">
            <span className="nx-mark">{tr.t("pb.notes.title")}</span>
          </h1>
          <p className="nx-helper">{tr.t("pb.notes.helper")}</p>
        </div>
        <Link href="/family/capture" className="nx-btn">
          <Icon name="camera" size={22} /> {tr.t("pb.notes.upload")}
        </Link>
      </header>
      {isDemo && (
        <div className="nx-demo-banner" role="note">
          <span className="nx-demo-banner__icon" aria-hidden="true">✦</span>
          <span className="nx-demo-banner__text">{tr.t("pb.notes.demoBanner")}</span>
          <DemoResetButton
            label={tr.t("pb.notes.demoReset")}
            resetLabel={tr.t("pb.notes.demoResetting")}
            doneLabel={tr.t("pb.notes.demoResetDone")}
          />
        </div>
      )}
      {updates}
      {missingNote && (
        <p role="status" className="nx-missing">
          {tr.t("pb.notes.missing")}
        </p>
      )}
      <div className="nx-grid">
        <section className="nx-panel" aria-label={tr.t("pb.notes.list")}>
          {rows.length === 0 ? (
            <div className="nx-empty">
              <span className="nx-empty__icon" aria-hidden="true">
                <Icon name="note" size={40} />
              </span>
              <h2 className="nx-empty__title">{tr.t("pb.notes.empty.title")}</h2>
              <p>{tr.t("pb.notes.empty.body")}</p>
            </div>
          ) : (
            <ul className="nx-list">
              {rows.map((r) => {
                const title = r.title ?? tr.t("pb.home.untitled");
                const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
                return (
                  <li key={r.noteId}>
                    <NoteRowLink
                      href={`/family?note=${r.noteId}`}
                      ariaLabel={tr.t("pb.notes.open", { title })}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- private route, checked on every request */}
                      <img
                        src={`/notes/${r.noteId}/image`}
                        alt={tr.t("pb.notes.thumbAlt")}
                        className="nx-row__thumb"
                        loading="lazy"
                        width={88}
                        height={88}
                      />
                      <span className="nx-row__body">
                        <span className="nx-row__title">{title}</span>
                        <span className="nx-row__meta">
                          <LocalTime iso={r.createdAt} language={language} compact />
                        </span>
                        <span className="nx-row__status">
                          <span className={`nx-chip nx-chip--${r.status}`}>
                            <Icon name={STATUS_ICON[r.status]} size={16} />{" "}
                            {tr.t(`pb.notes.status.${r.status}`)}
                          </span>
                          {r.reason && (
                            <span className="nx-row__reason">
                              {tr.tCount(`pb.notes.reason.${r.reason.kind}`, r.reason.count)}
                            </span>
                          )}
                          <span className="nx-row__progress">
                            {r.total > 0
                              ? tr.t("pb.notes.progress", { done: r.done, total: r.total })
                              : tr.t("pb.notes.progress.none")}
                          </span>
                        </span>
                        {r.total > 0 && (
                          <span className="nx-bar" aria-hidden="true">
                            <span style={{ width: `${pct}%` }} />
                          </span>
                        )}
                      </span>
                    </NoteRowLink>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {rows.length > 0 && viewerId !== "" && (
          <aside className="nx-side" aria-label={tr.t("pb.mine.title")}>
            <section className="nx-card" aria-labelledby="nx-mine-title">
              <h2 id="nx-mine-title" className="nx-card__title">
                {tr.t("pb.mine.title")} <span className="nx-card__for">{target}</span>
              </h2>
              <p className="nx-number" aria-label={tr.tCount("pb.mine.count", tally.mine.count)}>
                <span className="nx-number__value">{tally.mine.count}</span>
                <span className="nx-number__unit">
                  {tr
                    .tCount("pb.mine.count", tally.mine.count)
                    .replace(String(tally.mine.count), "")
                    .trim()}
                </span>
              </p>
              <p className="nx-hint">{tr.t("pb.mine.scope", { count: tally.notes })}</p>
              {tally.mine.count === 0 ? (
                <p className="nx-hint">{tr.t("pb.mine.none")}</p>
              ) : (
                <details className="nx-disclosure">
                  <summary>{tr.t("pb.mine.see")}</summary>
                  <div className="nx-done">
                    {tally.mine.byNote.map((n) => (
                      <section key={n.noteId}>
                        <h3 className="nx-done__note">
                          <Link
                            href={`/family?note=${n.noteId}`}
                            aria-label={tr.t("pb.mine.openNote", {
                              title: n.title ?? tr.t("pb.home.untitled"),
                            })}
                          >
                            {n.title ?? tr.t("pb.home.untitled")}
                          </Link>
                        </h3>
                        <ul>
                          {n.tasks.map((t) => (
                            <li key={t.partId}>
                              <Link
                                href={`/family/events/${n.noteId}?task=${t.partId}`}
                                aria-label={tr.t("pb.mine.openTask", { title: t.title })}
                              >
                                <Icon name="check" size={16} /> {t.title}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                </details>
              )}
            </section>
            <section className="nx-card" aria-labelledby="nx-family-title">
              <h2 id="nx-family-title" className="nx-card__title">
                {tr.t("pb.family.title")}
              </h2>
              {tally.family.length === 0 ? (
                <p className="nx-hint">{tr.t("pb.family.none")}</p>
              ) : (
                <ol className="nx-rank">
                  {tally.family.map((r) => (
                    <li
                      key={r.memberId}
                      className={r.memberId === viewerId ? "nx-rank__me" : undefined}
                    >
                      <span className="nx-rank__pos">
                        {tr.t(r.tied ? "thanksBoard.rankTied" : "thanksBoard.rank", {
                          rank: r.rank,
                        })}
                      </span>
                      <span className="nx-rank__name">{r.name}</span>
                      <span className="nx-rank__count">{tr.tCount("pb.thanks.line", r.done)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}
