"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { approvalLabelKey, labelMessageKey, riskLabelKey } from "@/lib/care/rules/labels";
import type { HelperRole } from "@/lib/care/rules/types";
import type { TimelineEntry } from "@/lib/care/timeline";
import { eventProgress, partBlockers, primaryCount, type Blocker } from "@/lib/family/dashboard";
import { computeOffers, type EventViewer, type ReceiverOption } from "@/lib/family/event-offers";
import { firstName } from "@/lib/family/names";
import { nextAction } from "@/lib/family/next-action";
import { savedAppointmentFacts } from "@/lib/family/appointment-facts";
import { taskState, taskViews, type TaskView } from "@/lib/family/playful";
import type { EventPart, MemberRef, MissingDetailView, SharedCareEvent } from "@/lib/family/shared-care-event";
import { formatDateTimeInZone, formatList } from "@/lib/i18n/format";
import { createTranslator, isMessageKey, type Language, type MessageKey, type Translator } from "@/lib/i18n/messages";
import { useRunner, type EventActions, type Runner } from "@/app/(family)/family/events/[noteId]/event-runner";
import { PartCard } from "@/app/(family)/family/events/[noteId]/part-card";
import {
  AmountForm,
  AnswerForm,
  AppointmentForm,
  DeadlineForm,
  isDeadlineQuestion,
  isStoredTaskDueQuestion,
} from "@/app/(family)/family/events/[noteId]/part-forms";
import { OriginalNote } from "./original-note";
import { Avatar, Chip, Icon, KIND_ICON, ProgressBar, Stamp, Tape } from "./ui";

export type EventDetailProps = {
  event: SharedCareEvent;
  viewer: EventViewer & { name: string };
  members: readonly ReceiverOption[];
  language: Language;
  nowIso: string;
  timeline: readonly TimelineEntry[];
  initialTaskId: string | null;
  actions: EventActions;
  onChanged: () => void;
};

const APPOINTMENT_CODES = new Set(["which_clinic", "which_date", "which_time"]);
const HIDDEN_ACTIVITY = new Set([
  "note.uploaded",
  "extraction_started",
  "extraction_succeeded",
  "extraction_failed",
  "reminder.sent",
  "ambiguities_detected",
]);

function Said({ runner }: { runner: Runner }) {
  return (
    <>
      <div role="status" aria-live="polite">
        {runner.message?.kind === "status" && (
          <p className="pb-live__ok">
            <Icon name="check" size={18} /> {runner.message.text}
          </p>
        )}
      </div>
      <div role="alert">{runner.message?.kind === "alert" && <p className="pb-live__error">{runner.message.text}</p>}</div>
    </>
  );
}

function questionText(tr: Translator, d: MissingDetailView): string {
  if (d.questionCode === "ai_question" && d.aiQuestion) return d.aiQuestion;
  const key = `missing.question.${d.questionCode}`;
  return isMessageKey(key) ? tr.t(key) : tr.t("missing.question.ai_question");
}

function Person({
  label,
  member,
  viewer,
  tr,
  children,
}: {
  label: string;
  member: MemberRef | null;
  viewer: EventProps["viewer"];
  tr: Translator;
  children?: React.ReactNode;
}) {
  const mine = member?.id === viewer.memberId;
  return (
    <li className="pb-person">
      <span className="pb-person__role">{label}</span>
      {member ? (
        <span className="pb-person__who">
          <Avatar name={member.name} householdId={viewer.householdId} memberId={member.id} size={64} ring={mine} />
          <span className="pb-person__name">{mine ? tr.t("pb.youName", { name: firstName(member.name) }) : firstName(member.name)}</span>
        </span>
      ) : (
        <span className="pb-person__empty">
          <span className="pb-person__none">{tr.t("pb.detail.noPerson")}</span>
          {children}
        </span>
      )}
    </li>
  );
}
export type EventProps = EventDetailProps;

function blockerText(tr: Translator, b: Blocker): string {
  switch (b.kind) {
    case "needsConfirmation":
      return tr.t("board.blocked.needsConfirmation");
    case "notApproved":
      return tr.t("board.blocked.notApproved");
    case "selfApproval":
      return tr.t("board.blocked.selfApproval");
    case "needsProof":
      return tr.t("board.blocked.needsProof", { list: formatList(b.missing, tr.lang) });
  }
}

export function TaskDetail({
  part,
  props,
  tr,
  inline = false,
}: {
  part: EventPart;
  props: EventProps;
  tr: Translator;
  /** Inside a board card that already shows the title: the title stays for screen readers only. */
  inline?: boolean;
}) {
  const { viewer, members, nowIso, actions, onChanged, timeline, event } = props;
  const runner = useRunner(tr, onChanged);
  const [editing, setEditing] = useState(false);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const offers = computeOffers(part, viewer, members, now);
  const blockers = partBlockers(part, viewer, primaryCount(members));
  const state = taskState(part);
  const travel = part.careCategory === "appointment" || part.careCategory === "transport";
  const isAppointment = part.careCategory === "appointment";
  const facts = savedAppointmentFacts(part, timeline);
  const closed = part.progressStatus === "completed" || part.progressStatus === "cancelled";
  const approvalKey = approvalLabelKey({ progressStatus: part.progressStatus, approvalState: part.approvalState });
  const question = part.missingDetails[0] ?? null;
  const canWrite = viewer.role !== "care_recipient" && !closed;
  const next = nextAction({
    offers,
    closed,
    canWrite,
    hasQuestion: Boolean(question),
    ownedByOther: Boolean(part.owner && part.owner.id !== viewer.memberId),
  });
  const apptQuestion = Boolean(
    question && question.storedDetailId === null && APPOINTMENT_CODES.has(question.questionCode),
  );
  // A real appointment without a family-confirmed clinic or time: the clarification form comes first.
  const needsAppt = isAppointment && canWrite && (!facts?.place || !facts?.time);
  const showNext = next.kind !== "none" && !needsAppt;
  const completeBlockers = blockers.filter((b) => b.kind !== "selfApproval");
  const factsWhen = (() => {
    if (!facts?.time) return null;
    try {
      return formatDateTimeInZone(new Date(facts.time.at), facts.time.timeZone, tr.lang);
    } catch {
      return null;
    }
  })();
  const savedBy = facts?.savedBy
    ? facts.savedBy.memberId === viewer.memberId
      ? tr.t("pb.detail.savedByYou")
      : facts.savedBy.name
        ? tr.t("pb.detail.savedBy", { name: firstName(facts.savedBy.name) })
        : tr.t("pb.detail.savedByFamily")
    : null;
  const claimButton = (role: HelperRole) =>
    offers.claim.includes(role) ? (
      <button
        type="button"
        className="pb-claim"
        disabled={runner.pending}
        onClick={() => runner.run(() => actions.claimPart({ stepId: part.id, role }))}
        aria-label={`${tr.t(`fam.claim.${role}` as MessageKey)} ${tr.t("board.task.claimContext", { title: part.title })}`}
      >
        {tr.t(`fam.claim.${role}` as MessageKey)}
      </button>
    ) : null;

  return (
    <article className={`pb-detail ${inline ? "pb-detail--inline" : ""}`} aria-labelledby={`pb-d-${part.id}`} data-task-detail={part.id}>
      {!inline && <Tape tone="mint" className="pb-detail__tape" />}
      <header className="pb-detail__head">
        <span className="pb-detail__icon" aria-hidden="true">
          <Icon name={KIND_ICON[taskViewIcon(part)]} size={38} />
        </span>
        <h2 id={`pb-d-${part.id}`} className={inline ? "sr-only" : "pb-detail__title"}>
          {part.title}
        </h2>
        <ul className="pb-detail__chips" aria-label={tr.t("event.part.progress")}>
          {state === "done" && (
            <li>
              <Stamp>{tr.t("pb.detail.doneStamp")}</Stamp>
            </li>
          )}
          {state === "pending" && (
            <li>
              <Chip>{tr.t("label.requiresConfirmation")}</Chip>
            </li>
          )}
          {approvalKey === "confirmed" && state !== "done" && (
            <li>
              <Chip tone="mint">
                <Icon name="check" size={16} /> {tr.t("pb.detail.confirmedBy")}
              </Chip>
            </li>
          )}
          {state === "unassigned" && (
            <li>
              <Chip tone="grey">{tr.t("pb.home.unassigned")}</Chip>
            </li>
          )}
          <li>
            <Chip tone="butter">{tr.t(labelMessageKey(riskLabelKey(part.riskLevel)))}</Chip>
          </li>
        </ul>
      </header>

      {needsAppt && (
        <section className="pb-next pb-clarify" aria-labelledby={`pb-clarify-${part.id}`} data-appt-clarify>
          <h3 id={`pb-clarify-${part.id}`} className="pb-next__title">
            {tr.t("pb.clarify.title")}
          </h3>
          <p>{tr.t("pb.clarify.why")}</p>
          <div className="pb-clarify__cols">
            <div>
              <h4>{tr.t("pb.clarify.fromNote")}</h4>
              {part.sourceQuote ? (
                <p>{tr.t("fam.quote", { quote: part.sourceQuote })}</p>
              ) : (
                <p>{tr.t("pb.clarify.noneInNote")}</p>
              )}
            </div>
            <div>
              <h4>{tr.t("pb.clarify.family")}</h4>
              <p>
                {tr.t("pb.detail.place")}: {facts?.place ?? tr.t("pb.clarify.notYet")}
              </p>
              <p>
                {tr.t("pb.detail.when")}: {factsWhen ?? tr.t("pb.clarify.notYet")}
              </p>
              {savedBy && <p>{savedBy}</p>}
            </div>
          </div>
          <AppointmentForm part={part} tr={tr} runner={runner} actions={actions} />
        </section>
      )}
      {showNext && (
        <section className="pb-next" aria-labelledby={`pb-next-${part.id}`}>
          <h3 id={`pb-next-${part.id}`} className="pb-next__title">
            {tr.t("pb.next.title")}
          </h3>
          <p>{tr.t(`pb.next.${next.kind}` as MessageKey, { name: part.owner ? firstName(part.owner.name) : "" })}</p>
          {next.kind === "confirm" && (
            <button
              type="button"
              className="pb-btn pb-btn--ember"
              disabled={runner.pending}
              onClick={() => runner.run(() => actions.decideApproval({ stepId: part.id, decision: "approve" }))}
            >
              {tr.t("pb.detail.confirm")}
            </button>
          )}
          {next.kind === "complete" && (
            <button
              type="button"
              className="pb-btn pb-btn--ink"
              disabled={runner.pending}
              onClick={() => runner.run(() => actions.completePart({ stepId: part.id }))}
            >
              <Icon name="check" size={20} /> {tr.t("pb.detail.complete")}
            </button>
          )}
          {next.kind === "details" && question && (
            <a className="pb-btn pb-btn--ink" href={`#pb-q-${question.key}`}>
              {tr.t("pb.next.detailsLink")}
            </a>
          )}
          {next.kind === "claim" && (
            <a className="pb-btn pb-btn--ink" href={`#pb-people-${part.id}`}>
              {tr.t("pb.next.claimLink")}
            </a>
          )}
        </section>
      )}
      {!needsAppt && (isAppointment || part.location) && (
        <section className="pb-facts" aria-label={tr.t("board.known.title")}>
          <span className="pb-facts__pin" aria-hidden="true" />
          {facts ? (
            <dl>
              <div>
                <dt>
                  <Icon name="pin" size={20} /> {tr.t("pb.detail.place")}
                </dt>
                <dd>{facts.place ?? tr.t("event.part.noLocation")}</dd>
              </div>
              <div>
                <dt>
                  <Icon name="calendar" size={20} /> {tr.t("pb.detail.when")}
                </dt>
                <dd>
                  {factsWhen ?? tr.t("pb.home.whenUnknown")}
                  {facts.time && <span className="pb-facts__zone"> · {tr.t("pb.detail.zone", { zone: facts.time.timeZone })}</span>}
                </dd>
              </div>
              {savedBy && (
                <div>
                  <dt>
                    <Icon name="user" size={20} /> {tr.t("board.known.title")}
                  </dt>
                  <dd>{savedBy}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p>{tr.t("pb.detail.notSaved")}</p>
          )}
        </section>
      )}

      {part.sourceQuote && !needsAppt && (
        <p className="pb-quote">
          <span>{tr.t("board.task.fromNote")}</span> {tr.t("fam.quote", { quote: part.sourceQuote })}
        </p>
      )}

      <section id={`pb-people-${part.id}`} aria-label={tr.t("pb.detail.people")}>
        <ul className="pb-people">
          <Person label={tr.t("pb.role.owner")} member={part.owner} viewer={viewer} tr={tr}>
            {canWrite && claimButton("owner")}
          </Person>
          {travel && (
            <>
              <Person label={tr.t("pb.role.driver")} member={part.driver} viewer={viewer} tr={tr}>
                {canWrite && claimButton("driver")}
              </Person>
              <Person label={tr.t("pb.role.companion")} member={part.companion} viewer={viewer} tr={tr}>
                {canWrite && claimButton("companion")}
              </Person>
            </>
          )}
        </ul>
      </section>

      {canWrite && (offers.approve || offers.complete || isAppointment || offers.completeWaiting) && (
        <div className="pb-actions">
          {offers.approve && (!showNext || next.kind !== "confirm") && (
            <button
              type="button"
              className="pb-btn pb-btn--ember"
              disabled={runner.pending}
              onClick={() => runner.run(() => actions.decideApproval({ stepId: part.id, decision: "approve" }))}
            >
              {tr.t("pb.detail.confirm")}
            </button>
          )}
          {offers.complete && (!showNext || next.kind !== "complete") && (
            <button
              type="button"
              className="pb-btn pb-btn--ink"
              disabled={runner.pending}
              onClick={() => runner.run(() => actions.completePart({ stepId: part.id }))}
            >
              <Icon name="check" size={20} /> {tr.t("pb.detail.complete")}
            </button>
          )}
          {isAppointment && !needsAppt && (
            <button
              type="button"
              className="pb-btn pb-btn--outline"
              aria-expanded={editing}
              onClick={() => setEditing((v) => !v)}
            >
              <Icon name="pencil" size={20} /> {editing ? tr.t("pb.detail.editClose") : tr.t("pb.detail.edit")}
            </button>
          )}
        </div>
      )}
      {canWrite && (offers.approve || offers.reject) && offers.selfApprovalNote && (
        <p className="pb-hint">{tr.t("event.approval.note")}</p>
      )}
      {canWrite &&
        completeBlockers.map((b) => (
          <p key={b.kind} className="pb-hint">
            {blockerText(tr, b)}
          </p>
        ))}
      {canWrite && blockers.some((b) => b.kind === "selfApproval") && <p className="pb-hint">{tr.t("board.blocked.selfApproval")}</p>}
      {canWrite && !offers.complete && part.owner && part.owner.id !== viewer.memberId && (
        <p className="pb-hint">{tr.t("pb.detail.waitingOwner", { name: firstName(part.owner.name) })}</p>
      )}

      {canWrite && isAppointment && !needsAppt && editing && (
        <div className="pb-form">
          <AppointmentForm part={part} tr={tr} runner={runner} actions={actions} />
        </div>
      )}
      {canWrite && question && !(needsAppt && apptQuestion) && !(isAppointment && editing && APPOINTMENT_CODES.has(question.questionCode)) && (
        <section className="pb-form" aria-labelledby={`pb-q-${question.key}`}>
          <h3 id={`pb-q-${question.key}`} className="pb-form__title">
            {questionText(tr, question)}
          </h3>
          {question.personToAsk && <p className="pb-hint">{tr.t("event.askPerson", { name: question.personToAsk })}</p>}
          {question.storedDetailId !== null && !isStoredTaskDueQuestion(part, question) && (
            <AnswerForm detail={question} tr={tr} runner={runner} actions={actions} />
          )}
          {question.storedDetailId === null && APPOINTMENT_CODES.has(question.questionCode) && (
            <AppointmentForm part={part} tr={tr} runner={runner} actions={actions} />
          )}
          {question.storedDetailId === null && question.questionCode === "which_amount" && (
            <AmountForm part={part} tr={tr} runner={runner} actions={actions} />
          )}
          {isStoredTaskDueQuestion(part, question) && (
            <DeadlineForm part={part} tr={tr} runner={runner} actions={actions} fixedTaskDue />
          )}
          {isDeadlineQuestion(part, question) && (
            <DeadlineForm part={part} tr={tr} runner={runner} actions={actions} />
          )}
        </section>
      )}
      <Said runner={runner} />

      <details className="pb-more">
        <summary>{tr.t("pb.detail.moreOptions")}</summary>
        <PartCard
          part={part}
          viewer={viewer}
          members={members}
          language={props.language}
          nowIso={nowIso}
          actions={actions}
          onChanged={onChanged}
        />
      </details>
      <span className="sr-only" data-note-id={event.noteId} />
    </article>
  );
}

function taskViewIcon(part: EventPart): TaskView["icon"] {
  return taskViews({ parts: [part] })[0].icon;
}

function activityText(tr: Translator, entry: TimelineEntry, mine: boolean): string {
  const who = mine ? tr.t("pb.you") : firstName(entry.actorName) || tr.t("thread.someone");
  if (entry.type === "recipient.replied") {
    const reply = entry.params.reply;
    if (reply === "thanks") return `${who}: ${tr.t("assistant.reply.thanks")}`;
    if (reply === "question") return `${who}: ${tr.t("assistant.reply.question")}`;
  }
  const label = isMessageKey(entry.labelKey) ? tr.t(entry.labelKey) : tr.t("timeline.unknown_event");
  const base = entry.stepTitle ? `${label}: ${entry.stepTitle}` : label;
  return entry.actorType === "human" ? `${who} · ${base}` : base;
}

export function EventDetail(props: EventDetailProps) {
  const { event, viewer, language, timeline, initialTaskId } = props;
  const tr = useMemo(() => createTranslator(language), [language]);
  const tasks = useMemo(() => taskViews(event), [event]);
  const firstOpen = tasks.find((t) => t.state !== "done") ?? tasks[0] ?? null;
  // The person's own choice wins; then a valid deep link; then the first open task. Derived on
  // every render, so a note that turns from "being read" to "ready" selects a task by itself and
  // an ordinary refresh keeps the choice (and the form the person is filling in).
  const [chosen, setChosen] = useState<string | null>(null);
  const valid = (id: string | null) => (id !== null && tasks.some((t) => t.partId === id) ? id : null);
  // The address bar is read in the browser too, so a deep link works even when the server did not
  // pass it (the page is rendered under Suspense).
  const urlTask = useSearchParams().get("task");
  const selected = valid(chosen) ?? valid(initialTaskId) ?? valid(urlTask) ?? firstOpen?.partId ?? null;
  const select = (id: string) => {
    setChosen(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("task", id);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The address bar is a nicety; selection works without it.
    }
  };
  const current = event.parts.find((p) => p.id === selected && p.progressStatus !== "cancelled") ?? null;
  const progress = eventProgress(event);
  const main = tasks.find((t) => t.isMain);
  const mainPart = main ? event.parts.find((p) => p.id === main.partId) : null;
  const appt = mainPart?.confirmed.appointment ?? null;
  const dateText = (() => {
    if (!appt) return null;
    try {
      return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
        timeZone: appt.timeZone,
        month: "long",
        day: "numeric",
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(appt.at));
    } catch {
      return null;
    }
  })();
  const recent = useMemo(
    () =>
      [...timeline]
        .filter((e) => !HIDDEN_ACTIVITY.has(e.type))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, 5),
    [timeline],
  );
  const quotes = event.parts.flatMap((p) => (p.sourceQuote ? [p.sourceQuote] : []));
  const ready = event.state === "ready";
  const retry = useRunner(tr, props.onChanged);
  const { onChanged } = props;
  const waiting = event.state === "reading" || event.state === "uploaded";
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(onChanged, 5000);
    return () => clearInterval(id);
  }, [waiting, onChanged]);

  return (
    <div className="pb-eventpage">
      <Link href="/family" className="pb-back">
        <Icon name="chevronLeft" size={20} /> {tr.t("pb.notes.back")}
      </Link>
      <div className="pb-eventpage__head">
        <div>
          <h1 className="pb-title">
            <span className="pb-title__mark">{event.title ?? tr.t("event.fallbackTitle")}</span>
          </h1>
          {ready && (
            <p className="pb-when">
              <Icon name="calendar" size={26} />
              <span>{dateText ?? tr.t("pb.home.whenUnknown")}</span>
            </p>
          )}
        </div>
        {ready && (
          <ProgressBar
            done={progress.done}
            total={progress.total}
            label={tr.t("pb.progress", { done: progress.done, total: progress.total })}
            aria={tr.t("pb.progress.aria", { done: progress.done, total: progress.total })}
          />
        )}
        <OriginalNote
          noteId={event.noteId}
          quotes={quotes}
          className="pb-link pb-link--button"
          labels={{
            open: tr.t("pb.memo.view"),
            title: tr.t("pb.memo.title"),
            close: tr.t("pb.memo.close"),
            alt: tr.t("pb.memo.photoAlt"),
            quotesTitle: tr.t("board.note.quotes"),
            quotesHint: tr.t("board.note.quotesHint"),
            noQuotes: tr.t("pb.memo.noQuotes"),
          }}
        >
          {tr.t("pb.memo.view")}
        </OriginalNote>
      </div>

      {!ready ? (
        <ReadingPanel
          event={event}
          tr={tr}
          canRetry={viewer.role !== "care_recipient"}
          retry={retry}
          onRetry={() =>
            retry.run(async () => {
              const result = await props.actions.retryRecognition(event.noteId);
              return result.ok ? { ...result, messageKey: undefined } : result;
            })
          }
        />
      ) : (
        <div className="pb-eventpage__grid">
          <nav className="pb-timeline" aria-label={tr.t("pb.detail.tasks")}>
            <span className="pb-timeline__clip" aria-hidden="true" />
            {tasks.length === 0 ? (
              <p>{tr.t("pb.detail.noTasks")}</p>
            ) : (
              <ol>
                {tasks.map((t) => (
                  <li key={t.partId}>
                    <button
                      type="button"
                      className={`pb-timeline__item pb-timeline__item--${t.state}`}
                      aria-current={t.partId === selected ? "true" : undefined}
                      aria-label={tr.t("pb.detail.selectTask", { title: t.title })}
                      onClick={() => select(t.partId)}
                    >
                      <span className="pb-timeline__dot" aria-hidden="true">
                        {t.state === "done" && <Icon name="check" size={14} />}
                      </span>
                      <span className="pb-timeline__icon" aria-hidden="true">
                        <Icon name={KIND_ICON[t.icon]} size={26} />
                      </span>
                      <span className="pb-timeline__text">
                        <span className="pb-timeline__title">{t.title}</span>
                        <span className="pb-timeline__state">
                          {t.state === "done"
                            ? tr.t("pb.stamp.done")
                            : t.state === "pending"
                              ? tr.t("label.requiresConfirmation")
                              : t.state === "unassigned"
                                ? tr.t("pb.home.unassigned")
                                : firstName(t.owner?.name)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </nav>

          <div className="pb-eventpage__main">
            {current ? <TaskDetail key={current.id} part={current} props={props} tr={tr} /> : null}
            <section className="pb-recent" aria-labelledby="pb-recent-title">
              <h2 id="pb-recent-title" className="pb-ribbon pb-ribbon--butter">
                {tr.t("pb.detail.recent")}
              </h2>
              {recent.length === 0 ? (
                <p>{tr.t("pb.detail.noActivity")}</p>
              ) : (
                <ul>
                  {recent.map((e) => {
                    const mine = e.actorMemberId === viewer.memberId;
                    return (
                      <li key={e.id}>
                        <Avatar name={e.actorName} householdId={viewer.householdId} memberId={e.actorMemberId ?? null} size={40} />
                        <span>{activityText(tr, e, mine)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link href={`/family/events/${event.noteId}/timeline`} className="pb-link">
                {tr.t("pb.detail.timeline")}
              </Link>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shown while the note is being read, and when reading failed. The user may leave and come back. */
function ReadingPanel({
  event,
  tr,
  canRetry,
  retry,
  onRetry,
}: {
  event: SharedCareEvent;
  tr: Translator;
  canRetry: boolean;
  retry: ReturnType<typeof useRunner>;
  onRetry: () => void;
}) {
  const failed = event.state === "failed";
  return (
    <div className="pb-state" role={failed ? "alert" : "status"} aria-live={failed ? undefined : "polite"}>
      <ul className="pb-reading__steps">
        <li>
          <Icon name="check" size={18} /> {tr.t("pb.reading.saved")}
        </li>
        <li>{failed ? tr.t("pb.home.failedTitle") : <><span className="pb-spinner" aria-hidden="true" /> {tr.t("pb.reading.status")}</>}</li>
      </ul>
      {/* eslint-disable-next-line @next/next/no-img-element -- private route, checked on every request */}
      <img src={`/notes/${event.noteId}/image`} alt={tr.t("pb.reading.original")} className="pb-reading__preview" />
      <p>{failed ? tr.t("pb.home.failedBody") : tr.t("pb.reading.leave")}</p>
      <div className="pb-state__actions">
        <Link href="/family" className="pb-btn pb-btn--outline">
          <Icon name="chevronLeft" size={20} /> {tr.t("pb.notes.back")}
        </Link>
        {failed && event.retryable && canRetry && (
          <button type="button" className="pb-btn pb-btn--ink" disabled={retry.pending} onClick={onRetry}>
            <Icon name="refresh" size={20} /> {retry.pending ? tr.t("event.btn.working") : tr.t("pb.home.retry")}
          </button>
        )}
      </div>
      <Said runner={retry} />
    </div>
  );
}
