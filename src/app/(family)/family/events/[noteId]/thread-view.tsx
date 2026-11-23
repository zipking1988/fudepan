"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { LocalDateTime } from "@/components/app/local-date-time";
import type { TimelineEntry } from "@/lib/care/timeline";
import { approvalLabelKey, labelMessageKey, riskLabelKey } from "@/lib/care/rules/labels";
import type { HelperRole } from "@/lib/care/rules/types";
import { computeOffers } from "@/lib/family/event-offers";
import type { EventPart, MissingDetailView } from "@/lib/family/shared-care-event";
import { buildThread, type ThreadItem } from "@/lib/family/thread";
import { createTranslator, isMessageKey, type MessageKey, type Translator } from "@/lib/i18n/messages";
import { useRunner, type EventActions, type Runner } from "./event-runner";
import type { EventViewProps } from "./event-view";
import { PartCard } from "./part-card";
import { AmountForm, AnswerForm, AppointmentForm, DeadlineForm } from "./part-forms";

export type ThreadViewProps = EventViewProps & {
  timeline: readonly TimelineEntry[];
  viewerName: string | null;
  /** Display name of the household's care recipient, if there is one. */
  recipientName?: string | null;
};

const READING_REFRESH_MS = 5000;
const APPOINTMENT_CODES = new Set(["which_clinic", "which_date", "which_time"]);
const CLAIM_ORDER: HelperRole[] = ["owner", "driver", "companion"];

function initial(name: string | null): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

function Avatar({ name, bot }: { name: string | null; bot?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-bold ${
        bot ? "bg-[#1f2de6] text-white" : "bg-stone-200 text-stone-800"
      }`}
    >
      {bot ? "F" : initial(name)}
    </span>
  );
}

/** One message row. Mine sit on the right, like any family chat. */
function Row({
  who,
  avatar,
  at,
  bot,
  mine,
  tr,
  children,
}: {
  who: string;
  /** Name the avatar initial comes from, when it differs from the label (e.g. "You"). */
  avatar?: string | null;
  at: string | null;
  bot?: boolean;
  mine?: boolean;
  tr: Translator;
  children: ReactNode;
}) {
  return (
    <li className={`flex items-start gap-3 ${mine ? "flex-row-reverse" : ""}`}>
      <Avatar name={avatar ?? who} bot={bot} />
      <div className={`grid min-w-0 max-w-[36rem] gap-1 ${mine ? "justify-items-end" : ""}`}>
        <p className="text-sm text-stone-600">
          {who}
          {at && (
            <>
              {" · "}
              <LocalDateTime iso={at} lang={tr.lang} />
            </>
          )}
        </p>
        {children}
      </div>
    </li>
  );
}

const BUBBLE = "rounded-2xl border border-stone-300 bg-white px-4 py-3 text-lg leading-relaxed";

function questionText(tr: Translator, d: MissingDetailView): string {
  if (d.questionCode === "ai_question" && d.aiQuestion) return d.aiQuestion;
  const key = `missing.question.${d.questionCode}`;
  return isMessageKey(key) ? tr.t(key) : tr.t("missing.question.ai_question");
}

function reasonText(tr: Translator, d: MissingDetailView): string {
  const key = d.reasonCode;
  return isMessageKey(key) ? tr.t("event.missing.why", { reason: tr.t(key) }) : "";
}

function RunnerMessage({ runner }: { runner: Runner }) {
  return (
    <>
      <div role="status" aria-live="polite">
        {runner.message?.kind === "status" && <p className="app-success">{runner.message.text}</p>}
      </div>
      <div role="alert">{runner.message?.kind === "alert" && <p className="app-alert">{runner.message.text}</p>}</div>
    </>
  );
}

/** The one open question, with the form that answers it. */
function QuestionCard({
  part,
  detail,
  remaining,
  canAnswer,
  tr,
  actions,
  onChanged,
}: {
  part: EventPart;
  detail: MissingDetailView;
  remaining: number;
  canAnswer: boolean;
  tr: Translator;
  actions: EventActions;
  onChanged: () => void;
}) {
  const runner = useRunner(tr, onChanged);
  const why = reasonText(tr, detail);
  return (
    <section
      id="thread-question"
      aria-labelledby={`q-${detail.key}`}
      className="grid gap-3 rounded-2xl border-2 border-[#c4552f] bg-white px-4 py-4 text-lg"
    >
      <p className="text-sm font-bold uppercase tracking-wide text-[#a9431f]">{tr.t("thread.question.label")}</p>
      <h3 id={`q-${detail.key}`} className="text-xl font-semibold">
        {questionText(tr, detail)}
      </h3>
      <p className="app-hint">{part.title}</p>
      {why && <p className="app-hint">{why}</p>}
      {detail.personToAsk && <p className="app-hint">{tr.t("event.askPerson", { name: detail.personToAsk })}</p>}
      {canAnswer && detail.storedDetailId !== null && (
        <AnswerForm detail={detail} tr={tr} runner={runner} actions={actions} />
      )}
      {canAnswer && detail.storedDetailId === null && APPOINTMENT_CODES.has(detail.questionCode) && (
        <AppointmentForm part={part} tr={tr} runner={runner} actions={actions} />
      )}
      {canAnswer && detail.storedDetailId === null && detail.questionCode === "which_amount" && (
        <AmountForm part={part} tr={tr} runner={runner} actions={actions} />
      )}
      {canAnswer && detail.storedDetailId === null && detail.questionCode === "when_is_deadline" && (
        <DeadlineForm part={part} tr={tr} runner={runner} actions={actions} />
      )}
      <RunnerMessage runner={runner} />
      <p className="app-hint">
        {remaining > 0 ? tr.t("thread.question.remaining", { remaining }) : tr.t("thread.question.lastOne")}
      </p>
    </section>
  );
}

/** A thing to do, as a card in the conversation. The full card with every option opens below. */
function ThreadPart({ part, props, tr }: { part: EventPart; props: ThreadViewProps; tr: Translator }) {
  const { viewer, members, nowIso, actions, onChanged } = props;
  const runner = useRunner(tr, onChanged);
  const offers = computeOffers(part, viewer, members, new Date(nowIso));
  const approvalKey = approvalLabelKey({ progressStatus: part.progressStatus, approvalState: part.approvalState });
  const done = part.progressStatus === "completed";
  const claims = CLAIM_ORDER.filter((r) => offers.claim.includes(r));
  const helper = (role: HelperRole, ref: EventPart["owner"]) =>
    ref ? tr.t("event.helper.line", { role: tr.t(`role.${role}` as MessageKey), name: ref.name ?? tr.t("thread.someone") }) : null;
  const travel = part.careCategory === "appointment" || part.careCategory === "transport";
  const holders = [
    helper("owner", part.owner),
    travel ? helper("driver", part.driver) : null,
    travel ? helper("companion", part.companion) : null,
  ].filter((x): x is string => Boolean(x));
  return (
    <article aria-labelledby={`tp-${part.id}`} className={`${BUBBLE} grid gap-3`}>
      <ul className="flex flex-wrap gap-2 text-sm" aria-label={tr.t("event.part.progress")}>
        <li className="app-status">{tr.t(labelMessageKey(riskLabelKey(part.riskLevel)))}</li>
        {approvalKey && <li className="app-status">{tr.t(labelMessageKey(approvalKey))}</li>}
        {!done && part.owner === null && <li className="app-status">{tr.t("event.part.needsSomeone")}</li>}
      </ul>
      <h3 id={`tp-${part.id}`} className={`text-xl font-semibold ${done ? "line-through decoration-2" : ""}`}>
        {part.title}
      </h3>
      {part.sourceQuote && (
        <blockquote className="border-l-4 border-stone-300 pl-3 italic text-stone-700">{part.sourceQuote}</blockquote>
      )}
      {holders.length > 0 && (
        <ul className="grid gap-1 text-base">
          {holders.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
      {(claims.length > 0 || offers.complete) && (
        <div className="flex flex-wrap gap-2">
          {claims.map((role) => (
            <button
              key={role}
              type="button"
              className="app-button min-h-12 rounded-full"
              disabled={runner.pending}
              onClick={() => runner.run(() => actions.claimPart({ stepId: part.id, role }))}
            >
              {tr.t(`event.btn.claim.${role}` as MessageKey)}
            </button>
          ))}
          {offers.complete && (
            <button
              type="button"
              className="app-button min-h-12 rounded-full"
              disabled={runner.pending}
              onClick={() => runner.run(() => actions.completePart({ stepId: part.id }))}
            >
              {tr.t("event.btn.complete")}
            </button>
          )}
        </div>
      )}
      <RunnerMessage runner={runner} />
      <details className="group">
        <summary className="min-h-12 cursor-pointer py-2 text-base font-semibold text-[#1f2de6]">
          {tr.t("thread.part.more")}
        </summary>
        <div className="mt-2">
          <PartCard
            part={part}
            viewer={viewer}
            members={members}
            language={props.language}
            nowIso={nowIso}
            actions={actions}
            onChanged={onChanged}
          />
        </div>
      </details>
    </article>
  );
}

/** "Haruko (Mom)" -> "Haruko"; Japanese adds さん. Falls back to a neutral phrase. */
export function personName(displayName: string | null, tr: Translator): string {
  const base = (displayName ?? "").replace(/\s*[(（].*?[)）]\s*/g, " ").trim();
  if (!base) return tr.t("thread.recipientFallback");
  return tr.lang === "ja" ? `${base}さん` : base;
}

function activityText(tr: Translator, entry: TimelineEntry): string {
  if (entry.type === "recipient.replied") {
    const reply = entry.params.reply;
    if (reply === "thanks") return `👍 ${tr.t("thread.reply.thanks")}`;
    if (reply === "question") return `🙋 ${tr.t("thread.reply.question")}`;
  }
  const label = isMessageKey(entry.labelKey) ? tr.t(entry.labelKey) : tr.t("timeline.unknown_event");
  return entry.stepTitle ? `${label}: ${entry.stepTitle}` : label;
}

/** Up to three one-tap replies for what this person can do right now. */
function QuickReplies({ props, tr, hasQuestion }: { props: ThreadViewProps; tr: Translator; hasQuestion: boolean }) {
  const { event, viewer, members, nowIso, actions, onChanged } = props;
  const runner = useRunner(tr, onChanged);
  if (viewer.role === "care_recipient") return null;
  const chips: { key: string; label: string; onClick: () => void }[] = [];
  const now = new Date(nowIso);
  for (const part of event.parts) {
    const offers = computeOffers(part, viewer, members, now);
    if (offers.claim.includes("driver") && !chips.some((c) => c.key === "drive")) {
      chips.push({
        key: "drive",
        label: tr.t("thread.quick.drive"),
        onClick: () => runner.run(() => actions.claimPart({ stepId: part.id, role: "driver" })),
      });
    }
    if (offers.claim.includes("companion") && !chips.some((c) => c.key === "go")) {
      chips.push({
        key: "go",
        label: tr.t("thread.quick.goWith"),
        onClick: () => runner.run(() => actions.claimPart({ stepId: part.id, role: "companion" })),
      });
    }
    if (offers.claim.includes("owner") && !chips.some((c) => c.key === "take")) {
      chips.push({
        key: "take",
        label: tr.t("thread.quick.takeTask", { title: part.title }),
        onClick: () => runner.run(() => actions.claimPart({ stepId: part.id, role: "owner" })),
      });
    }
  }
  const shown = chips.slice(0, 3);
  return (
    <div className="sticky bottom-0 z-10 -mx-4 grid gap-1 border-t border-stone-300 bg-white px-4 pb-2 pt-2 sm:mx-0 sm:rounded-2xl sm:border">
      <p className="sr-only">{tr.t("thread.quick.label")}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" role="group" aria-label={tr.t("thread.quick.label")}>
        {hasQuestion && (
          <a href="#thread-question" className="app-button app-button--quiet min-h-12 shrink-0 whitespace-nowrap rounded-full">
            {tr.t("thread.quick.answer")}
          </a>
        )}
        {shown.map((c) => (
          <button
            key={c.key}
            type="button"
            className="app-button app-button--quiet min-h-12 max-w-[16rem] shrink-0 truncate whitespace-nowrap rounded-full"
            disabled={runner.pending}
            onClick={c.onClick}
          >
            {c.label}
          </button>
        ))}
        <Link href="/family/capture" className="app-button app-button--quiet min-h-12 shrink-0 whitespace-nowrap rounded-full">
          {tr.t("thread.quick.photo")}
        </Link>
      </div>
      <RunnerMessage runner={runner} />
      <p className="text-center text-xs text-stone-600">{tr.t("thread.footer")}</p>
    </div>
  );
}

function ReadingRefresh({ onChanged }: { onChanged: () => void }) {
  useEffect(() => {
    const timer = setInterval(onChanged, READING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [onChanged]);
  return null;
}

export function ThreadView(props: ThreadViewProps) {
  const { event, timeline, viewerName, viewer, language, actions, onChanged } = props;
  const tr = createTranslator(language);
  const items = buildThread({
    event,
    timeline,
    viewerName,
    recipientName: personName(props.recipientName ?? null, tr),
  });
  const partById = new Map(event.parts.map((p) => [p.id, p]));
  const hasQuestion = items.some((i) => i.kind === "question");
  const canAnswer = viewer.role !== "care_recipient";
  const fudepan = tr.t("timeline.actor.system");
  const retry = useRunner(tr, onChanged);

  const render = (item: ThreadItem) => {
    switch (item.kind) {
      case "photo":
        return (
          <Row key={item.id} who={item.actorName ?? tr.t("thread.someone")} at={item.at} tr={tr}>
            <a href={`/notes/${event.noteId}/image`} className={`${BUBBLE} block p-2`}>
              {/* The route checks the session and household on every request. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/notes/${event.noteId}/image`}
                alt={tr.t("thread.photo.alt")}
                className="max-h-80 w-auto max-w-full rounded-lg"
              />
            </a>
            <p className="text-sm text-stone-600">{tr.t("thread.photo.caption")}</p>
          </Row>
        );
      case "bot":
        return (
          <Row key={item.id} who={fudepan} at={item.at} bot tr={tr}>
            <p className={BUBBLE} role={item.key === "thread.bot.reading" ? "status" : undefined}>
              {tr.t(item.key, item.params)}
            </p>
            {item.key === "thread.bot.failed" && event.retryable && canAnswer && (
              <>
                <button
                  type="button"
                  className="app-button min-h-12 rounded-full"
                  disabled={retry.pending}
                  onClick={() =>
                    retry.run(async () => {
                      const result = await actions.retryRecognition(event.noteId);
                      return result.ok ? { ...result, messageKey: undefined } : result;
                    })
                  }
                >
                  {retry.pending ? tr.t("event.btn.working") : tr.t("event.failed.retry")}
                </button>
                <RunnerMessage runner={retry} />
              </>
            )}
          </Row>
        );
      case "question": {
        const part = partById.get(item.partId);
        if (!part) return null;
        return (
          <Row key={item.id} who={fudepan} at={null} bot tr={tr}>
            <QuestionCard
              part={part}
              detail={item.detail}
              remaining={item.remaining}
              canAnswer={canAnswer}
              tr={tr}
              actions={actions}
              onChanged={onChanged}
            />
          </Row>
        );
      }
      case "part": {
        const part = partById.get(item.partId);
        if (!part) return null;
        return (
          <Row key={item.id} who={fudepan} at={null} bot tr={tr}>
            <ThreadPart part={part} props={props} tr={tr} />
          </Row>
        );
      }
      case "activity": {
        const who = item.mine
          ? tr.t("thread.you")
          : item.entry.actorType === "human"
            ? (item.entry.actorName ?? tr.t("thread.someone"))
            : fudepan;
        return (
          <Row
            key={item.id}
            who={who}
            avatar={item.entry.actorName}
            at={item.entry.at}
            bot={item.entry.actorType !== "human"}
            mine={item.mine}
            tr={tr}
          >
            <p className={`${BUBBLE} ${item.mine ? "border-[#1f2de6] bg-[#1f2de6] text-white" : ""}`}>
              {activityText(tr, item.entry)}
            </p>
          </Row>
        );
      }
    }
  };

  return (
    <div className="grid gap-4">
      <header className="grid gap-1">
        <h1 className="app-title">{event.title ?? tr.t("event.fallbackTitle")}</h1>
        <p>
          <Link href={`/family/events/${event.noteId}/timeline`} className="app-link text-lg">
            {tr.t("thread.timeline.link")}
          </Link>
        </p>
      </header>
      {(event.state === "reading" || event.state === "uploaded") && <ReadingRefresh onChanged={onChanged} />}
      <ol aria-label={tr.t("thread.listLabel")} className="grid gap-5 rounded-3xl bg-[#eef0f3] p-3 sm:p-5">
        {items.map(render)}
      </ol>
      {event.state === "ready" && !event.done && <QuickReplies props={props} tr={tr} hasQuestion={hasQuestion} />}
    </div>
  );
}
