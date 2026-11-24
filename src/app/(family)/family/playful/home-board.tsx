"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { claimPart, retryRecognition } from "@/app/(family)/family/actions";
import { useRunner } from "@/app/(family)/family/events/[noteId]/event-runner";
import { eventProgress, claimTargets, dropClaimInput } from "@/lib/family/dashboard";
import { savedAppointmentFacts } from "@/lib/family/appointment-facts";
import { nextAction } from "@/lib/family/next-action";
import { computeOffers, type EventViewer, type ReceiverOption } from "@/lib/family/event-offers";
import { leaderboard } from "@/lib/family/leaderboard";
import { firstName } from "@/lib/family/names";
import { celebrationKey, taskViews, type TaskView } from "@/lib/family/playful";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import type { HelperRole } from "@/lib/care/rules/types";
import {
  createTranslator,
  type Language,
  type MessageKey,
  type Translator,
} from "@/lib/i18n/messages";
import { useEventActions } from "@/app/(family)/family/events/[noteId]/event-view-connected";
import type { ReactNode } from "react";
import type { TimelineEntry } from "@/lib/care/timeline";
import { TaskDetail, type EventProps } from "./event-detail";
import { OriginalNote } from "./original-note";
import { Avatar, Chip, Icon, KIND_ICON, ProgressBar, Stamp, Tape } from "./ui";

export type HomeBoardProps = {
  event: SharedCareEvent;
  viewer: EventViewer & { name: string; portraitSrc?: string | null };
  members: readonly ReceiverOption[];
  language: Language;
  nowIso: string;
  recipient: { id: string; name: string; portraitSrc?: string | null } | null;
  quotes: string[];
  /** This note's timeline, for the saved appointment facts shown in an open task card. */
  timeline?: readonly TimelineEntry[];
  /** Task to open on arrival (?task=). Unknown ids are ignored. */
  initialTaskId?: string | null;
};

const ROLE_SLOTS: HelperRole[] = ["driver", "companion", "owner"];
const REFRESH_MS = 5000;

function RoleSlot({
  task,
  role,
  tr,
  viewer,
  claimable,
  busy,
  landed,
  onClaim,
}: {
  task: TaskView;
  role: HelperRole;
  tr: Translator;
  viewer: HomeBoardProps["viewer"];
  claimable: boolean;
  busy: boolean;
  landed: boolean;
  onClaim: (partId: string, role: HelperRole) => void;
}) {
  const holder = role === "owner" ? task.owner : role === "driver" ? task.driver : task.companion;
  const roleLabel = tr.t(`pb.role.${role}` as MessageKey);
  const mine = holder?.id === viewer.memberId;
  return (
    <div
      className={`pb-slot ${holder ? "pb-slot--filled" : ""} ${claimable ? "pb-slot--claimable" : ""} ${landed ? "pb-slot--landed" : ""}`}
      data-drop={claimable ? `${task.partId}:${role}` : undefined}
    >
      {task.travel && <span className="pb-slot__role">{roleLabel}</span>}
      {holder ? (
        <span className="pb-slot__who">
          <Avatar
            name={holder.name}
            householdId={viewer.householdId}
            memberId={holder.id}
            size={46}
            ring={mine}
          />
          <span className="pb-slot__name">{mine ? tr.t("pb.you") : firstName(holder.name)}</span>
        </span>
      ) : claimable ? (
        <span className="pb-slot__empty">
          <button
            type="button"
            className="pb-claim"
            data-claim-btn
            disabled={busy}
            onClick={() => onClaim(task.partId, role)}
            aria-label={`${tr.t(`fam.claim.${role}` as MessageKey)} ${tr.t("board.task.claimContext", { title: task.title })}`}
          >
            {tr.t(`fam.claim.${role}` as MessageKey)}
          </button>
        </span>
      ) : (
        <span className="pb-slot__none">{task.state === "done" ? "–" : tr.t("pb.role.empty")}</span>
      )}
    </div>
  );
}

function TaskRow({
  task,
  noteId,
  tr,
  viewer,
  claimRoles,
  busy,
  landed,
  onClaim,
  open,
  onToggle,
  detail,
}: {
  task: TaskView;
  noteId: string;
  tr: Translator;
  viewer: HomeBoardProps["viewer"];
  claimRoles: ReadonlySet<HelperRole>;
  busy: boolean;
  landed: { partId: string; role: HelperRole } | null;
  onClaim: (partId: string, role: HelperRole) => void;
  open: boolean;
  onToggle: () => void;
  /** The full task detail with its actions, rendered only while the card is open. */
  detail: ReactNode;
}) {
  const slots = task.travel ? ROLE_SLOTS : (["owner"] as HelperRole[]);
  const panelId = `pb-taskpanel-${task.partId}`;
  const toggleId = `pb-tasktoggle-${task.partId}`;
  const hasClaim = slots.some((r) => claimRoles.has(r));
  const state = task.state === "unassigned" && hasClaim ? "open" : task.state;
  return (
    <li className={`pb-task pb-task--${state}`} data-task-state={task.state}>
      <span className="pb-task__dot" aria-hidden="true">
        {task.state === "done" && <Icon name="check" size={16} />}
      </span>
      <div className="pb-task__body">
        <div className="pb-task__head">
          <span className="pb-task__icon" aria-hidden="true">
            <Icon name={KIND_ICON[task.icon]} size={30} />
          </span>
          <div className="pb-task__titles">
            <span className="pb-task__title" data-note-id={noteId}>
              {task.title}
            </span>
            {task.place && <span className="pb-task__sub">{task.place}</span>}
            {task.state === "pending" && (
              <span className="pb-task__sub">{tr.t("pb.home.waitingConfirm")}</span>
            )}
          </div>
          <div className="pb-task__status">
            {task.state === "done" && <Stamp>{tr.t("pb.stamp.done")}</Stamp>}
            {task.state === "pending" && <Chip>{tr.t("label.requiresConfirmation")}</Chip>}
            {task.state === "unassigned" && <Chip tone="grey">{tr.t("pb.home.unassigned")}</Chip>}
          </div>
        </div>
        <div className={`pb-task__slots ${task.travel ? "pb-task__slots--travel" : ""}`}>
          {slots.map((role) => (
            <RoleSlot
              key={role}
              task={task}
              role={role}
              tr={tr}
              viewer={viewer}
              claimable={claimRoles.has(role) && task.state !== "done"}
              busy={busy}
              landed={landed?.partId === task.partId && landed.role === role}
              onClaim={onClaim}
            />
          ))}
        </div>
        <button
          type="button"
          id={toggleId}
          className={`pb-task__toggle ${open ? "pb-task__toggle--open" : ""}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          data-open-task
        >
          <span>{open ? tr.t("pb.card.hide") : tr.t("pb.card.show")}</span>
          <span className="sr-only"> {task.title}</span>
          <Icon name="chevronRight" size={22} className="pb-task__chev" />
        </button>
        <div id={panelId} role="region" aria-labelledby={toggleId} className="pb-task__panel" tabIndex={-1} hidden={!open}>
          {open && detail}
        </div>
      </div>
    </li>
  );
}

/** The viewer's own photo. Dragged onto an open spot it makes the same claim as the button. */
function Sticker({
  tr,
  viewer,
  targets,
  disabled,
  onDrop,
  onMiss,
  onKeyboard,
}: {
  tr: Translator;
  viewer: HomeBoardProps["viewer"];
  targets: ReturnType<typeof claimTargets>;
  disabled: boolean;
  onDrop: (partId: string, role: HelperRole) => void;
  onMiss: () => void;
  onKeyboard: () => void;
}) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const hitAt = useCallback((x: number, y: number): string | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const key = (el as HTMLElement).dataset?.drop;
      if (key) return key;
    }
    return null;
  }, []);

  function down(e: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, moved: false };
    setDrag({ dx: 0, dy: 0 });
  }
  function move(e: ReactPointerEvent<HTMLButtonElement>) {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) s.moved = true;
    setDrag({ dx, dy });
    setHot(hitAt(e.clientX, e.clientY));
  }
  function up(e: ReactPointerEvent<HTMLButtonElement>) {
    const s = start.current;
    start.current = null;
    setDrag(null);
    setHot(null);
    if (!s || !s.moved) return;
    const key = hitAt(e.clientX, e.clientY);
    const [partId, role] = key ? key.split(":") : [];
    const input = dropClaimInput(targets, key ? { partId, role: role as HelperRole } : null);
    if (input) onDrop(input.stepId, input.role);
    else onMiss();
  }
  function cancel() {
    start.current = null;
    setDrag(null);
    setHot(null);
  }
  // Mirror the hot spot onto the board so the open spots light up while dragging.
  useEffect(() => {
    const board = document.querySelector<HTMLElement>("[data-board]");
    if (!board) return;
    if (drag) board.dataset.dragging = "";
    else delete board.dataset.dragging;
    board.querySelectorAll<HTMLElement>("[data-drop]").forEach((el) => {
      if (hot && el.dataset.drop === hot) el.dataset.hot = "";
      else delete el.dataset.hot;
    });
  }, [drag, hot]);

  return (
    <div className="pb-sticker-wrap">
      <button
        type="button"
        className={`pb-sticker ${drag ? "pb-sticker--lifted" : ""}`}
        style={
          drag
            ? { transform: `translate(${drag.dx}px, ${drag.dy}px) rotate(-4deg) scale(1.08)` }
            : undefined
        }
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        onClick={(e) => {
          // A click with no pointer movement and no mouse (Enter or Space) is the keyboard path.
          if (e.detail === 0) onKeyboard();
        }}
        disabled={disabled}
        aria-describedby="pb-drag-help"
        data-sticker
      >
        <Avatar
          name={viewer.name}
          householdId={viewer.householdId}
          memberId={viewer.memberId}
          src={viewer.portraitSrc ?? null}
          size={92}
          ring
        />
        <span className="pb-sticker__label">
          <strong>{tr.t("pb.drag.label", { name: firstName(viewer.name) })}</strong>
          <span>{tr.t("pb.drag.hint")}</span>
        </span>
      </button>
      <p id="pb-drag-help" className="sr-only">
        {tr.t("pb.drag.help")}
      </p>
    </div>
  );
}

function ThanksBoard({
  event,
  tr,
  householdId,
  viewerId,
}: {
  event: SharedCareEvent;
  tr: Translator;
  householdId: string;
  viewerId: string;
}) {
  const rows = leaderboard(event);
  const open = taskViews(event).filter((t) => t.state !== "done");
  const target = open.find((t) => t.owner?.id === viewerId) ?? open[0] ?? null;
  const claimed = event.parts.filter(
    (p) =>
      p.progressStatus !== "cancelled" &&
      p.progressStatus !== "completed" &&
      (p.owner || p.driver || p.companion),
  ).length;
  return (
    <section className="pb-thanks" aria-labelledby="pb-thanks-title">
      <h2 id="pb-thanks-title" className="pb-ribbon pb-ribbon--apricot">
        {tr.t("pb.thanks.title")}
      </h2>
      {rows.length === 0 ? (
        <div className="pb-thanks__empty">
          <p>{tr.t("pb.thanks.empty.first")}</p>
          {claimed > 0 && <p>{tr.t("pb.thanks.claimedNone", { count: claimed })}</p>}
          {target && (
            <Link href={`/family?note=${event.noteId}&task=${target.partId}`} className="pb-link">
              {tr.t("pb.thanks.empty.open")}: {target.title}
            </Link>
          )}
        </div>
      ) : (
        <ol className="pb-thanks__list">
          {rows.map((r) => (
            <li
              key={r.memberId}
              className={`pb-thanks__row ${r.best ? "pb-thanks__row--best" : ""}`}
            >
              <Avatar name={r.name} householdId={householdId} memberId={r.memberId} size={44} />
              <span className="pb-thanks__name">{r.name}</span>
              <span className="pb-thanks__count">{tr.tCount("pb.thanks.line", r.done)}</span>
              <span className="pb-thanks__rank">
                {tr.t(r.tied ? "thanksBoard.rankTied" : "thanksBoard.rank", { rank: r.rank })}
              </span>
              {r.best && (
                <span className="pb-thanks__best">
                  <Icon name="sparkle" size={16} /> {tr.t("pb.thanks.best")}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Once per note, the first time every task is done on this device. "Seen" is written when the
 * celebration actually opens, not when the timer is scheduled, so a development double-run of the
 * effect (Strict Mode cleans up and runs again) cannot swallow it. With reduced motion nothing
 * moves: the same card appears as plain text and a button.
 */
function Celebration({ event, tr }: { event: SharedCareEvent; tr: Translator }) {
  const [shown, setShown] = useState(false);
  const rows = leaderboard(event);
  const finished = event.state === "ready" && event.done;
  const key = celebrationKey(event.noteId);
  useEffect(() => {
    if (!finished) return;
    const open = window.setTimeout(() => {
      let seen = false;
      try {
        seen = window.localStorage.getItem(key) !== null;
      } catch {
        // Storage may be blocked. Then it shows once per page view.
      }
      if (seen) return;
      try {
        window.localStorage.setItem(key, "1");
      } catch {
        // Nothing to remember it with.
      }
      setShown(true);
    }, 0);
    return () => window.clearTimeout(open);
  }, [finished, key]);
  useEffect(() => {
    if (!shown) return;
    const close = window.setTimeout(() => setShown(false), 9000);
    return () => window.clearTimeout(close);
  }, [shown]);
  if (!shown) return null;
  const best = rows.filter((r) => r.best).map((r) => r.name);
  return (
    <div className="pb-party" role="status" aria-live="polite" data-party>
      <div className="pb-party__card">
        <Icon name="sparkle" size={34} />
        <p className="pb-party__title">{tr.t("pb.party.title")}</p>
        {best.length > 0 && (
          <p className="pb-party__best">
            {tr.t("pb.thanks.best")}: {best.join(" · ")}
          </p>
        )}
        <button type="button" className="pb-btn pb-btn--ink" onClick={() => setShown(false)}>
          {tr.t("pb.party.close")}
        </button>
      </div>
    </div>
  );
}

/** Refreshes the page by itself while the note is still being read. */
function usePollWhileReading(active: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [active, router]);
}

function ReadingOrFailed({ event, tr }: { event: SharedCareEvent; tr: Translator }) {
  const router = useRouter();
  const runner = useRunner(tr, () => router.refresh());
  usePollWhileReading(event.state === "reading" || event.state === "uploaded");
  if (event.state === "failed") {
    return (
      <div className="pb-state" role="alert">
        <h2 className="pb-state__title">{tr.t("pb.home.failedTitle")}</h2>
        <p>{tr.t("pb.home.failedBody")}</p>
        <div className="pb-state__actions">
          {event.retryable && (
            <button
              type="button"
              className="pb-btn pb-btn--ink"
              disabled={runner.pending}
              onClick={() =>
                runner.run(async () => {
                  const result = await retryRecognition(event.noteId);
                  return result.ok ? { ...result, messageKey: undefined } : result;
                })
              }
            >
              <Icon name="refresh" size={20} />{" "}
              {runner.pending ? tr.t("event.btn.working") : tr.t("pb.home.retry")}
            </button>
          )}
        </div>
        <div role="status" aria-live="polite">
          {runner.message?.kind === "status" && <p>{tr.t("event.retryStarted")}</p>}
        </div>
        {runner.message?.kind === "alert" && (
          <p className="pb-state__error">{runner.message.text}</p>
        )}
      </div>
    );
  }
  return (
    <div className="pb-state" role="status" aria-live="polite">
      <span className="pb-spinner" aria-hidden="true" />
      <h2 className="pb-state__title">{tr.t("pb.home.readingTitle")}</h2>
      <p>{tr.t("pb.home.readingBody")}</p>
    </div>
  );
}

export function HomeBoard({
  event,
  viewer,
  members,
  language,
  nowIso,
  recipient,
  quotes,
  timeline = [],
  initialTaskId = null,
}: HomeBoardProps) {
  const tr = useMemo(() => createTranslator(language), [language]);
  const router = useRouter();
  const runner = useRunner(tr, () => router.refresh());
  const { actions, onChanged } = useEventActions();
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() =>
    initialTaskId && event.parts.some((p) => p.id === initialTaskId) ? new Set([initialTaskId]) : new Set(),
  );
  /** Opens or closes one task card and keeps ?task= in the address so the card can be linked to. */
  function setOpen(partId: string, next: boolean) {
    setOpenIds((prev) => {
      const out = new Set(prev);
      if (next) out.add(partId);
      else out.delete(partId);
      return out;
    });
    try {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("task", partId);
      else if (url.searchParams.get("task") === partId) url.searchParams.delete("task");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // The address bar is a nicety; the card opens without it.
    }
  }
  const detailProps: EventProps = {
    event,
    viewer,
    members,
    language,
    nowIso,
    timeline,
    initialTaskId: null,
    actions,
    onChanged,
  };
  const [landed, setLanded] = useState<{ partId: string; role: HelperRole } | null>(null);
  const [miss, setMiss] = useState(false);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const ready = event.state === "ready";
  const tasks = useMemo(() => taskViews(event), [event]);
  const progress = eventProgress(event);
  const targets = useMemo(
    () => claimTargets(event, viewer, members, now),
    [event, viewer, members, now],
  );
  const claimByPart = useMemo(() => {
    const map = new Map<string, Set<HelperRole>>();
    for (const part of event.parts) {
      const roles = new Set<HelperRole>(computeOffers(part, viewer, members, now).claim);
      if (roles.size > 0) map.set(part.id, roles);
    }
    return map;
  }, [event.parts, viewer, members, now]);
  const when = useMemo(() => {
    const main = tasks.find((t) => t.isMain);
    return main
      ? (event.parts.find((p) => p.id === main.partId)?.confirmed.appointment ?? null)
      : null;
  }, [tasks, event.parts]);
  /** The one thing this viewer can do next, from the same offers and guards the task cards use. */
  const focus = useMemo(() => {
    if (!ready || viewer.role === "care_recipient") return null;
    const order = ["confirm", "complete", "details", "claim"] as const;
    let best: { partId: string; title: string; kind: (typeof order)[number] } | null = null;
    for (const part of event.parts) {
      if (part.progressStatus === "cancelled" || part.progressStatus === "completed") continue;
      const offers = computeOffers(part, viewer, members, now);
      const facts = savedAppointmentFacts(part, timeline);
      const needsAppointment =
        part.careCategory === "appointment" && (!facts?.place || !facts?.time);
      const next = nextAction({
        offers,
        closed: false,
        canWrite: true,
        hasQuestion: part.missingDetails.length > 0 || needsAppointment,
        ownedByOther: false,
      });
      const kind = needsAppointment && next.kind !== "none" ? "details" : next.kind;
      if (kind !== "confirm" && kind !== "complete" && kind !== "details" && kind !== "claim")
        continue;
      if (!best || order.indexOf(kind) < order.indexOf(best.kind))
        best = { partId: part.id, title: part.title, kind };
    }
    return best;
  }, [ready, event.parts, viewer, members, now, timeline]);
  /** Opens the task card and moves focus to its form (or the card itself) once it has rendered. */
  function goToTask(partId: string, kind: string) {
    setOpen(partId, true);
    window.setTimeout(() => {
      const card = document.getElementById(`pb-taskpanel-${partId}`);
      const target =
        (kind === "details"
          ? card?.querySelector<HTMLElement>("[data-appt-clarify] input, .pb-form input, .pb-form textarea")
          : null) ?? card;
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    }, 50);
  }
  const recipientName = recipient ? firstName(recipient.name) : tr.t("pb.home.forFallback");
  const canClaim = ready && viewer.role !== "care_recipient";

  function claim(partId: string, role: HelperRole) {
    setMiss(false);
    const part = event.parts.find((p) => p.id === partId);
    runner.run(
      () => claimPart({ stepId: partId, role }),
      () => {
        setLanded({ partId, role });
        // The claimed task opens so its next step is right there.
        setOpen(partId, true);
        window.setTimeout(() => setLanded(null), 1600);
        if (part)
          runner.say({ kind: "status", text: tr.t("pb.drag.landed", { title: part.title }) });
      },
    );
  }
  function keyboardJump() {
    const btn = document.querySelector<HTMLButtonElement>(
      "[data-board] [data-claim-btn]:not(:disabled)",
    );
    if (btn) btn.focus();
    else runner.say({ kind: "status", text: tr.t("pb.drag.none") });
  }

  const whenText = (() => {
    if (!when) return null;
    try {
      return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
        timeZone: when.timeZone,
        month: "long",
        day: "numeric",
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(when.at));
    } catch {
      return null;
    }
  })();

  return (
    <div className="pb-home">
      <Celebration event={event} tr={tr} />
      <Link href="/family" className="pb-link pb-back">
        <span aria-hidden="true">←</span> {tr.t("pb.notes.back")}
      </Link>
      <div className="pb-home__grid">
        <section className="pb-clip" aria-labelledby="pb-board-title">
          <span className="pb-clip__clasp" aria-hidden="true" />
          <Tape tone="check" className="pb-clip__tape" />
          <div className="pb-clip__sheet" data-board>
            <h1 id="pb-board-title" className="pb-board-title">
              <span>{event.title ?? tr.t("pb.home.untitled")}</span>
            </h1>
            {ready ? (
              <p className="pb-when">
                <Icon name="calendar" size={26} />
                <span>{whenText ?? tr.t("pb.home.whenUnknown")}</span>
              </p>
            ) : null}

            {ready && (
              <div className="pb-focus">
                <div className="pb-focus__progress">
                  <ProgressBar
                    done={progress.done}
                    total={progress.total}
                    label={tr.t("pb.progress", { done: progress.done, total: progress.total })}
                    aria={tr.t("pb.progress.aria", { done: progress.done, total: progress.total })}
                  />
                </div>
                <section className="pb-focus__next" aria-labelledby="pb-focus-title">
                  <h2 id="pb-focus-title" className="pb-focus__title">
                    {tr.t("pb.next.title")}
                  </h2>
                  {focus ? (
                    <>
                      <p>{tr.t(`pb.focus.${focus.kind}` as MessageKey, { title: focus.title })}</p>
                      <button
                        type="button"
                        className="pb-btn pb-btn--ink"
                        onClick={() => goToTask(focus.partId, focus.kind)}
                      >
                        {tr.t(`pb.focus.btn.${focus.kind}` as MessageKey)}
                        <span className="sr-only">: {focus.title}</span>
                      </button>
                    </>
                  ) : (
                    <p>{tr.t("pb.focus.none")}</p>
                  )}
                </section>
              </div>
            )}

            {canClaim && (
              <Sticker
                tr={tr}
                viewer={viewer}
                targets={targets}
                disabled={runner.pending}
                onDrop={claim}
                onMiss={() => setMiss(true)}
                onKeyboard={keyboardJump}
              />
            )}

            {ready ? (
              tasks.length > 0 ? (
                <ol className="pb-tasks" aria-label={tr.t("pb.home.tasks")}>
                  {tasks.map((task) => (
                    <TaskRow
                      key={task.partId}
                      task={task}
                      noteId={event.noteId}
                      tr={tr}
                      viewer={viewer}
                      claimRoles={claimByPart.get(task.partId) ?? new Set()}
                      busy={runner.pending}
                      landed={landed}
                      onClaim={claim}
                      open={openIds.has(task.partId)}
                      onToggle={() => setOpen(task.partId, !openIds.has(task.partId))}
                      detail={(() => {
                        const part = event.parts.find((p) => p.id === task.partId);
                        return part ? <TaskDetail key={part.id} part={part} props={detailProps} tr={tr} inline /> : null;
                      })()}
                    />
                  ))}
                </ol>
              ) : (
                <p className="pb-state">{tr.t("pb.home.noTasks")}</p>
              )
            ) : (
              <ReadingOrFailed event={event} tr={tr} />
            )}

            <div className="pb-live" role="status" aria-live="polite">
              {runner.pending && <p>{tr.t("pb.drag.working")}</p>}
              {!runner.pending && miss && <p>{tr.t("pb.drag.miss")}</p>}
              {!runner.pending && !miss && runner.message?.kind === "status" && (
                <p className="pb-live__ok">
                  <Icon name="check" size={18} /> {runner.message.text}
                </p>
              )}
            </div>
            {runner.message?.kind === "alert" && (
              <p role="alert" className="pb-live__error">
                {tr.t("pb.drag.failed", { reason: runner.message.text })}
              </p>
            )}
          </div>
        </section>
        <aside className="pb-home__side" aria-label={recipientName}>
          {recipient || viewer.role === "care_recipient" ? (
            <figure className="pb-polaroid">
              <Tape tone="apricot" className="pb-polaroid__tape" />
              <div className="pb-polaroid__photo">
                <Avatar
                  name={recipient?.name ?? null}
                  householdId={viewer.householdId}
                  memberId={recipient?.id}
                  src={recipient?.portraitSrc ?? null}
                  size={240}
                  className="pb-avatar--square"
                />
              </div>
              <figcaption className="pb-polaroid__name">{recipientName}</figcaption>
            </figure>
          ) : (
            <div className="pb-setup">
              <p>{tr.t("pb.recipient.setupBody")}</p>
              <Link href="/family/members" className="pb-btn pb-btn--ink">
                {tr.t("pb.recipient.setup")}
              </Link>
            </div>
          )}
          {recipient && viewer.role === "primary_caregiver" && (
            <Link href="/family/members" className="pb-link">
              {recipient.portraitSrc ? tr.t("pb.portrait.change") : tr.t("pb.portrait.add")}
              <span className="sr-only"> {tr.t("pb.portrait.label", { name: recipientName })}</span>
            </Link>
          )}

          {ready && (
            <div className="pb-side-progress">
              <ProgressBar
                done={progress.done}
                total={progress.total}
                label={tr.t("pb.progress", { done: progress.done, total: progress.total })}
                aria={tr.t("pb.progress.aria", { done: progress.done, total: progress.total })}
              />
            </div>
          )}

          <div className="pb-memo">
            <span className="pb-memo__pin" aria-hidden="true" />
            <OriginalNote
              noteId={event.noteId}
              quotes={quotes}
              className="pb-memo__paper"
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
              {/* eslint-disable-next-line @next/next/no-img-element -- private route, checked on every request */}
              <img
                src={`/notes/${event.noteId}/image`}
                alt=""
                className="pb-memo__img"
                loading="lazy"
              />
              <span className="pb-memo__link">{tr.t("pb.memo.view")}</span>
            </OriginalNote>
          </div>

          {ready && (
            <ThanksBoard
              event={event}
              tr={tr}
              householdId={viewer.householdId}
              viewerId={viewer.memberId}
            />
          )}
          <Link href={`/family/events/${event.noteId}/timeline`} className="pb-link">
            {tr.t("pb.home.recordLink")}
          </Link>
        </aside>

      </div>
    </div>
  );
}
