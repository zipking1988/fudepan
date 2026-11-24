"use client";

import Image from "next/image";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { RiskLevel } from "@/lib/care/risk";
import { refusalMessageKey } from "@/lib/care/rules/refusals";
import type { HelperRole } from "@/lib/care/rules/types";
import type { Language } from "@/lib/i18n/format";
import { createTranslator, type MessageKey } from "@/lib/i18n/messages";
import Link from "next/link";
import { EXAMPLE_COPY, IMAGE_SIZE, IMAGES, LINKS, type ExampleCopy } from "./content";
import {
  allDone,
  alwaysShowsComplete,
  awaitsConfirmation,
  canComplete,
  canConfirm,
  canFillClinic,
  canRelease,
  claim,
  companionMissing,
  complete,
  completionBlock,
  confirm,
  contributions,
  DEFAULT_PERSON,
  dropClaim,
  dropTargets,
  findTask,
  grandmaPhotoIndex,
  initialExample,
  isAvailable,
  isConfirmed,
  isExampleOnlyRefusal,
  isHelper,
  isNewCompletion,
  leaderboard,
  parseClinicName,
  PEOPLE,
  PRIMARY,
  progress,
  release,
  removeThanks,
  saveClinic,
  sendThanks,
  sentThanks,
  STICKERS,
  thanksOn,
  thanksRecipient,
  waitingOn,
  type ClinicNameProblem,
  type ContributionItem,
  type ExampleRefusal,
  type ExampleResult,
  type ExampleState,
  type ExampleTask,
  type PersonId,
  type StickerId,
  type TaskId,
  type ThanksList,
} from "./example";
import {
  Calendar,
  Car,
  Check,
  Chevron,
  Clinic,
  Crown,
  DropIn,
  Glasses,
  Heart,
  Hourglass,
  IdCard,
  Question,
  RiskHigh,
  RiskLow,
  RiskMedium,
  Sparkle,
  Undo,
} from "./icons";

const TASK_ICON: Record<TaskId, (p: { className?: string }) => ReactNode> = {
  card: IdCard,
  clinic: Question,
  visit: Clinic,
  glasses: Glasses,
};

/** Risk labels come from the app dictionaries, so the landing uses the same words as the app. */
const RISK: Record<RiskLevel, { key: MessageKey; Icon: (p: { className?: string }) => ReactNode }> = {
  low: { key: "label.lowPriority", Icon: RiskLow },
  medium: { key: "label.needsAttention", Icon: RiskMedium },
  high: { key: "label.highRisk", Icon: RiskHigh },
};


/** Roles shown on a task, in this order. */
const ROLE_ORDER: HelperRole[] = ["driver", "companion", "owner"];
/** Movement in pixels before a press on a face becomes a drag. */
const DRAG_THRESHOLD = 6;
/** How long after a drag ends the browser's follow-up click is ignored (it would re-select or move focus). */
const CLICK_AFTER_DRAG_MS = 500;

type Action = "claim" | "confirm" | "complete" | "release";
type Said = { text: string; tone: "info" | "error" };
type Drag = {
  pointerId: number;
  person: PersonId;
  from: HTMLElement;
  startX: number;
  startY: number;
  lift: number;
  active: boolean;
  over: TaskId | null;
};

const ACTIONS: Record<Action, (s: ExampleState, id: TaskId, person: PersonId) => ExampleResult> = {
  claim,
  confirm,
  complete,
  release,
};

/**
 * The owner to offer 「ケンタに切り替える」 for on the visit card: only once the
 * primary caregiver has confirmed it, while someone else is selected, and only if
 * the owner could then finish it. Null before confirmation, when already acting as
 * the owner, and after completion. Switching only selects the person; it changes no task.
 */
export function ownerShortcut(task: ExampleTask, actor: PersonId): PersonId | null {
  const owner = task.holders.owner;
  if (!alwaysShowsComplete(task) || !isConfirmed(task) || !owner || owner === actor) return null;
  return canComplete(task, owner) ? owner : null;
}

/** Cards without an approval step that offer a switch to their owner: the insurance card, Misa's from the start. */
const OWNER_SWITCH_TASKS: readonly TaskId[] = ["card"];

/**
 * The person-switch button on a card, and the button it leads to.
 * Visit, before confirmation: 「ミサに切り替える」, once the clinic is saved and
 * Misa can confirm, while Yui or Kenta is selected; it leads to 「確認する」.
 * Visit, after confirmation: the owner shortcut above, leading to 「完了にする」.
 * Insurance card: a switch to its current owner while someone else is selected
 * and the owner could finish it, leading to 「完了にする」. Switching only selects
 * the person; the task stays as it is until that button is pressed.
 */
export type CardShortcut = { person: PersonId; then: "confirm" | "complete" };

export function cardShortcut(task: ExampleTask, actor: PersonId): CardShortcut | null {
  if (!alwaysShowsComplete(task)) {
    if (!OWNER_SWITCH_TASKS.includes(task.id) || task.status === "completed") return null;
    const owner = task.holders.owner;
    return owner && owner !== actor && canComplete(task, owner) ? { person: owner, then: "complete" } : null;
  }
  if (awaitsConfirmation(task)) {
    return actor !== PRIMARY && canConfirm(task, PRIMARY) ? { person: PRIMARY, then: "confirm" } : null;
  }
  const owner = ownerShortcut(task, actor);
  return owner ? { person: owner, then: "complete" } : null;
}

/**
 * What 「病院名を確認する」 at the top of the example does for the selected
 * person, from the clinic task as it is now: `claim` it (the same claim as the
 * card's button), go to its name field (`fill`), or just `show` the card when
 * someone else has it. Null once it is done, and the button goes away.
 */
export type ClinicStart = "claim" | "fill" | "show";

export function clinicStart(task: ExampleTask | undefined, actor: PersonId): ClinicStart | null {
  if (!task || task.status === "completed") return null;
  if (canFillClinic(task, actor)) return "fill";
  if (isAvailable(task, actor)) return "claim";
  return "show";
}

/** Japanese sentences run on; English ones need a space between them. */
function joinSentences(lang: Language, ...parts: string[]): string {
  return parts.join(lang === "ja" ? "" : " ");
}

/**
 * The working example under the hero. The visitor chooses who they act as
 * (Misa, Kenta, or Yui) with the faces in the tray. They take a task on with
 * the 「引き受ける」 button (touch, keyboard, screen reader) or by dragging a
 * face onto it (mouse, touch, pen). Both call the same guarded `claim`.
 */
export function CareExample({ lang, demoConfigured = false }: { lang: Language; demoConfigured?: boolean }) {
  const c = EXAMPLE_COPY[lang];
  const tr = createTranslator(lang);
  const ids = useId();
  const [state, setState] = useState<ExampleState>(initialExample);
  const [actor, setActor] = useState<PersonId>(DEFAULT_PERSON);
  const [said, setSaid] = useState<Said | null>(null);
  const [dragging, setDragging] = useState<PersonId | null>(null);
  const [over, setOver] = useState<TaskId | null>(null);
  const [clinicDraft, setClinicDraft] = useState("");
  const [clinicError, setClinicError] = useState<ClinicNameProblem | null>(null);
  /** Goes up by one for each completed task, so the photo accent replays once per completion. 0 = none yet. */
  const [celebration, setCelebration] = useState(0);
  /** Thank-you stickers. Apart from `state`, so they can never change a task. Kept when switching person. */
  const [thanks, setThanks] = useState<ThanksList>([]);
  /** The sticker picker that is open: which task, and for whom (it closes when the person changes). */
  const [picker, setPicker] = useState<{ task: TaskId; from: PersonId } | null>(null);
  /** The sticker that just arrived or changed, so only it pops; `n` replays the pop on each send. */
  const [pop, setPop] = useState<{ task: TaskId; from: PersonId; n: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const ignoreClickUntil = useRef(0);
  /** `data-focus` value to move focus to after the next render, so a button that disappears never drops focus. */
  const focusNext = useRef<string | null>(null);
  /** Also scroll that element into view (the start button sends people to a card further down). */
  const scrollNext = useRef(false);

  useEffect(() => {
    const target = focusNext.current;
    if (!target) return;
    focusNext.current = null;
    const scroll = scrollNext.current;
    scrollNext.current = false;
    const [task] = target.split(":");
    const root = rootRef.current;
    const el =
      root?.querySelector<HTMLElement>(`[data-focus="${target}"]`) ??
      root?.querySelector<HTMLElement>(`[data-focus="${task}:title"]`);
    // The page's own scroll-behavior decides smooth or instant, so reduced motion is respected.
    if (scroll) el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  });

  const { done, total } = progress(state);
  const photo = grandmaPhotoIndex(done);
  const hospital = findTask(state, "visit")?.missingHospital ?? null;
  const start = clinicStart(findTask(state, "clinic"), actor);
  const name = (person: PersonId) => c.people[person];
  const primaryName = name(PRIMARY);
  const radioName = `${ids}-persona`;
  const hintId = `${ids}-hint`;

  /** Every way of picking a person ends here: the tray, a drag, and the in-card shortcuts. */
  function choosePerson(person: PersonId) {
    setActor(person);
    setPicker(null);
  }

  function refusalText(code: ExampleRefusal): string {
    return isExampleOnlyRefusal(code) ? c.refusal[code] : tr.t(refusalMessageKey(code));
  }

  function refuse(code: ExampleRefusal) {
    setSaid({ text: refusalText(code), tone: code === "no_target" ? "info" : "error" });
  }

  /** Applies a successful change: new state, the photo accent if a task got done, the status line, and focus. */
  function commit(next: ExampleState, text: string, focus: string) {
    const newlyDone = isNewCompletion(state, next);
    if (newlyDone) setCelebration((n) => n + 1);
    setState(next);
    setSaid({ text: newlyDone && allDone(next) ? joinSentences(lang, text, c.party.title) : text, tone: "info" });
    focusNext.current = focus;
  }

  function run(action: Action, id: TaskId) {
    apply(action, id, actor, ACTIONS[action](state, id, actor));
  }

  /** Shows a refusal, or commits the change with a message that names who did what. */
  function apply(action: Action, id: TaskId, person: PersonId, result: ExampleResult) {
    if (!result.ok) {
      refuse(result.code);
      return;
    }
    const before = findTask(state, id);
    const after = findTask(result.state, id);
    if (!before || !after) return;
    const title = c.tasks[id];
    const confirmAgain = isConfirmed(before) && awaitsConfirmation(after);

    if (action === "claim") {
      const text =
        id === "clinic" && after.askPerson
          ? c.said.claimedClinic(title, name(person), name(after.askPerson))
          : confirmAgain
            ? c.said.claimedConfirmAgain(title, name(person), primaryName)
            : awaitsConfirmation(after)
              ? after.claimRole === "companion"
                ? c.said.companionClaimed(name(person), primaryName)
                : c.said.claimedNeedsConfirm(title, name(person), primaryName)
              : c.said.claimed(title, name(person));
      const focus = canFillClinic(after, person)
        ? "clinic:input"
        : canComplete(after, person)
          ? `${id}:complete`
          : `${id}:release`;
      commit(result.state, text, focus);
    } else if (action === "confirm") {
      const owner = after.holders.owner;
      commit(
        result.state,
        c.said.confirmed(title, primaryName, owner ? name(owner) : c.status.unassigned),
        ownerShortcut(after, person) ? `${id}:switch` : `${id}:complete`,
      );
    } else if (action === "complete") {
      const p = progress(result.state);
      commit(result.state, c.said.completed(title, p.done, p.total), `${id}:title`);
    } else {
      const released = c.said.released(title, name(person), c.roles[before.claimRole]);
      const text = confirmAgain ? joinSentences(lang, released, c.waiting.confirm(primaryName)) : released;
      commit(result.state, text, `${id}:claim`);
    }
  }

  /** The in-card shortcut: acts as `person` from now on. Tasks, progress, and the photo stay as they are. */
  function switchPerson(person: PersonId, id: TaskId, then: CardShortcut["then"]) {
    choosePerson(person);
    const text = then === "confirm" ? c.said.switchedToConfirm : c.said.switched;
    setSaid({ text: text(c.tasks[id], name(person)), tone: "info" });
    focusNext.current = `${id}:${then}`;
  }

  /**
   * The start button. Unclaimed: the selected person claims the clinic task
   * through the usual claim (so the card's field appears), then the field is
   * scrolled into view and focused. Nothing is typed or saved for them.
   */
  function startClinic() {
    const step = clinicStart(findTask(state, "clinic"), actor);
    if (!step) return;
    if (step === "claim") {
      const result = claim(state, "clinic", actor);
      if (result.ok) scrollNext.current = true;
      apply("claim", "clinic", actor, result);
      return;
    }
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-focus="${step === "fill" ? "clinic:input" : "clinic:title"}"]`,
    );
    el?.scrollIntoView({ block: "center" });
    el?.focus({ preventScroll: true });
  }

  function openStickers(id: TaskId) {
    setPicker({ task: id, from: actor });
    focusNext.current = `${id}:sticker:${sentThanks(thanks, id, actor)?.sticker ?? STICKERS[0]}`;
  }

  function closeStickers(id: TaskId) {
    setPicker(null);
    focusNext.current = sentThanks(thanks, id, actor) ? `${id}:thanks-change` : `${id}:thanks-send`;
  }

  /** Sends or changes this person's sticker. Only `thanks` changes; tasks, progress, and the photo do not. */
  function pickSticker(id: TaskId, sticker: StickerId) {
    const before = sentThanks(thanks, id, actor);
    const result = sendThanks(state, thanks, id, actor, sticker);
    if (!result.ok) {
      refuse(result.code);
      return;
    }
    const to = sentThanks(result.thanks, id, actor)?.to;
    if (!to) return;
    const label = c.stickers.label[sticker];
    setThanks(result.thanks);
    setPicker(null);
    setPop((p) => ({ task: id, from: actor, n: (p?.n ?? 0) + 1 }));
    const text = before ? c.said.thanksChanged : c.said.thanksSent;
    setSaid({ text: text(name(actor), name(to), label), tone: "info" });
    focusNext.current = `${id}:thanks-change`;
  }

  function removeSticker(id: TaskId) {
    const mine = sentThanks(thanks, id, actor);
    if (!mine) return;
    setThanks(removeThanks(thanks, id, actor));
    setPicker(null);
    setSaid({ text: c.said.thanksRemoved(name(actor), name(mine.to), c.stickers.label[mine.sticker]), tone: "info" });
    focusNext.current = `${id}:thanks-send`;
  }

  function submitClinic() {
    const parsed = parseClinicName(clinicDraft);
    if (!parsed.ok) {
      // Keep what was typed, say exactly what is wrong, and put the cursor back in the field.
      setClinicError(parsed.code);
      focusNext.current = "clinic:input";
      setSaid(null);
      return;
    }
    const result = saveClinic(state, clinicDraft, actor);
    if (!result.ok) {
      refuse(result.code);
      return;
    }
    const p = progress(result.state);
    setClinicError(null);
    setClinicDraft("");
    commit(
      result.state,
      joinSentences(lang, c.said.clinicSaved(parsed.name), c.said.completed(c.tasks.clinic, p.done, p.total)),
      "clinic:title",
    );
  }

  function reset() {
    dragRef.current = null;
    setDragging(null);
    setOver(null);
    setState(initialExample());
    setActor(DEFAULT_PERSON);
    setClinicDraft("");
    setClinicError(null);
    setCelebration(0);
    setThanks([]);
    setPicker(null);
    setPop(null);
    setSaid({ text: c.said.reset(name(DEFAULT_PERSON)), tone: "info" });
  }

  // Drag and drop with pointer events, so mouse, touch, and pen all work.
  function dropTargetAt(x: number, y: number): TaskId | null {
    const hit = document.elementFromPoint(x, y);
    const row = hit instanceof Element ? hit.closest<HTMLElement>("[data-drop]") : null;
    if (!row || !rootRef.current?.contains(row)) return null;
    return (row.dataset.drop as TaskId | undefined) ?? null;
  }

  function placeGhost(d: Drag, x: number, y: number) {
    ghostRef.current?.style.setProperty("transform", `translate3d(${x}px, ${y - d.lift}px, 0)`);
    const from = d.from.getBoundingClientRect();
    const line = lineRef.current;
    if (!line) return;
    line.setAttribute("x1", String(from.left + from.width / 2));
    line.setAttribute("y1", String(from.top + from.height / 2));
    line.setAttribute("x2", String(x));
    line.setAttribute("y2", String(y - d.lift));
  }

  function onPointerDown(person: PersonId, e: ReactPointerEvent<HTMLSpanElement>) {
    // A face with nothing to take on is still a plain choice: the click selects it.
    if (!e.isPrimary || e.button !== 0 || dropTargets(state, person).length === 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      person,
      from: e.currentTarget,
      startX: e.clientX,
      startY: e.clientY,
      // Lift the face above a finger so it stays visible on touch screens.
      lift: e.pointerType === "touch" ? 44 : 0,
      active: false,
      over: null,
    };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLSpanElement>) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.active = true;
      // Dragging a face acts as that person, so the selected face always matches the one being moved.
      choosePerson(d.person);
      setDragging(d.person);
    }
    placeGhost(d, e.clientX, e.clientY);
    const target = dropTargetAt(e.clientX, e.clientY);
    if (target !== d.over) {
      d.over = target;
      setOver(target);
    }
  }

  function endDrag(e: ReactPointerEvent<HTMLSpanElement>, dropped: boolean) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(null);
    setOver(null);
    if (!d.active) return;
    ignoreClickUntil.current = e.timeStamp + CLICK_AFTER_DRAG_MS;
    if (!dropped) return;
    const target = dropTargetAt(e.clientX, e.clientY) ?? d.over;
    // Same guarded claim as the button. A missed or refused drop changes nothing; the message says why.
    const result = dropClaim(state, target, d.person);
    if (target === null) refuse(result.ok ? "no_target" : result.code);
    else apply("claim", target, d.person, result);
  }

  function onPersonaClick(e: ReactMouseEvent<HTMLLabelElement>) {
    if (e.timeStamp < ignoreClickUntil.current) e.preventDefault();
  }

  function openNote() {
    dialogRef.current?.showModal();
  }

  function closeNote() {
    dialogRef.current?.close();
  }

  return (
    <div ref={rootRef} className="lp-app" role="region" aria-label={c.region} data-dragging={dragging ? "" : undefined}>
      <div className="lp-app__bar">
        <span className="lp-app__brand" aria-hidden="true">
          {c.appName}
        </span>
        <span className="lp-app__acting">
          <Avatar person={actor} />
          {c.start.actingAs(name(actor))}
        </span>
        {start && (
          <button type="button" className="lp-btn lp-btn--navy lp-btn--task lp-app__start" onClick={startClinic}>
            {c.tasks.clinic}
            <span className="lp-sr">{c.start.context(name(actor))}</span>
          </button>
        )}
      </div>

      <div className="lp-app__body">
        <div className="lp-app__side">
          <div className="lp-app__photo">
            {IMAGES.grandmaByDone.map((src, i) => (
              <Image
                key={src}
                src={src}
                alt={i === photo ? c.photoAlt[i] : ""}
                aria-hidden={i === photo ? undefined : true}
                data-active={i === photo}
                {...IMAGE_SIZE.grandmaByDone[i]}
                sizes="(min-width: 860px) 16rem, 40vw"
              />
            ))}
            {/* Replays once per completed task (new key), never on load or on a timer. */}
            {celebration > 0 && <Flourish key={celebration} />}
          </div>
          <div className="lp-app__who">
            <h3 className="lp-app__name">{c.recipient}</h3>
            <p className="lp-progress">
              <span className="lp-progress__text">{c.progress(done, total)}</span>
              <span className="lp-progress__bar" aria-hidden="true">
                {state.tasks.map((t, i) => (
                  <span key={t.id} data-filled={i < done} />
                ))}
              </span>
            </p>
            <p className="lp-progress__hint">{c.photoHint}</p>
          </div>
          <button type="button" className="lp-app__note" onClick={openNote}>
            <span className="lp-app__thumb">
              <Image src={IMAGES.note} alt="" {...IMAGE_SIZE.note} sizes="9rem" />
            </span>
            <span className="lp-app__noteLink">
              {c.viewNote}
              <Chevron />
            </span>
          </button>
        </div>

        <div className="lp-app__main">
          <h3 className="lp-app__event">
            <span className="lp-mark lp-mark--violet">{c.event.title}</span>
          </h3>
          <p className="lp-app__date">
            <Calendar />
            <span>{c.event.date}</span>
            <span className="lp-app__dateSource">{c.event.dateSource}</span>
          </p>

          <ol className="lp-tasks" aria-label={c.event.tasksLabel}>
            {state.tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                actor={actor}
                lang={lang}
                copy={c}
                riskLabel={tr.t(RISK[task.riskLevel].key)}
                doneLabel={tr.t("label.done")}
                confirmedLabel={tr.t("label.confirmed")}
                hospital={task.id === "clinic" || task.id === "visit" ? hospital : null}
                dragging={dragging}
                over={over === task.id}
                onAction={run}
                onSwitch={switchPerson}
                clinicForm={
                  task.id === "clinic" && canFillClinic(task, actor) ? (
                    <ClinicForm
                      copy={c}
                      title={c.tasks.clinic}
                      idBase={ids}
                      value={clinicDraft}
                      error={clinicError ? c.refusal[clinicError] : null}
                      onChange={(v) => {
                        setClinicDraft(v);
                        setClinicError(null);
                      }}
                      onSample={() => {
                        setClinicDraft(c.clinicForm.sampleName);
                        setClinicError(null);
                      }}
                      onSubmit={submitClinic}
                    />
                  ) : null
                }
                thanksBlock={
                  task.status === "completed" ? (
                    <TaskThanks
                      task={task}
                      actor={actor}
                      copy={c}
                      idBase={ids}
                      thanks={thanksOn(thanks, task.id)}
                      pickerOpen={picker?.task === task.id && picker.from === actor}
                      pop={pop?.task === task.id ? pop : null}
                      onOpen={() => openStickers(task.id)}
                      onClose={() => closeStickers(task.id)}
                      onPick={(sticker) => pickSticker(task.id, sticker)}
                      onRemove={() => removeSticker(task.id)}
                    />
                  ) : null
                }
              />
            ))}
          </ol>

          {allDone(state) && <FamilyParty state={state} copy={c} idBase={ids} celebration={celebration} lang={lang} demoConfigured={demoConfigured} />}

          <div className="lp-tray">
            <fieldset className="lp-tray__set" aria-describedby={hintId}>
              <legend className="lp-tray__legend">{c.persona.legend}</legend>
              <div className="lp-tray__people">
                {PEOPLE.map((p) => {
                  const selected = p.id === actor;
                  const canDrag = dropTargets(state, p.id).length > 0;
                  const { before, after } = c.persona.actAs(name(p.id));
                  return (
                    <label
                      key={p.id}
                      className="lp-persona"
                      data-selected={selected || undefined}
                      onClick={onPersonaClick}
                    >
                      <input
                        type="radio"
                        className="lp-sr"
                        name={radioName}
                        value={p.id}
                        checked={selected}
                        onChange={() => choosePerson(p.id)}
                      />
                      <span
                        className="lp-face"
                        data-can-drag={canDrag || undefined}
                        data-dragging={dragging === p.id || undefined}
                        onPointerDown={(e) => onPointerDown(p.id, e)}
                        onPointerMove={onPointerMove}
                        onPointerUp={(e) => endDrag(e, true)}
                        onPointerCancel={(e) => endDrag(e, false)}
                        onLostPointerCapture={(e) => endDrag(e, false)}
                      >
                        <Avatar person={p.id} size="large" />
                      </span>
                      <span className="lp-tray__name">
                        {before && <span className="lp-sr">{before}</span>}
                        {name(p.id)}
                        {after && <span className="lp-sr">{after}</span>}
                      </span>
                      {p.role === "primary_caregiver" && <span className="lp-tray__role">{c.primaryCaregiver}</span>}
                      {selected && (
                        <span className="lp-persona__current" aria-hidden="true">
                          <Check />
                          {c.persona.current}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <p id={hintId} className="lp-tray__hint">
              {c.dragHint}
            </p>
          </div>

          <div className="lp-app__status" role="status" aria-live="polite">
            {said && (
              <p data-tone={said.tone}>
                {said.tone === "error" ? <RiskMedium /> : <Check />}
                {said.text}
              </p>
            )}
          </div>

          <button type="button" className="lp-btn lp-btn--quiet lp-app__reset" onClick={reset}>
            <Undo />
            {c.reset}
          </button>
        </div>

        <ThanksBoard state={state} copy={c} />
      </div>

      {/* The face that follows the pointer while dragging, and the dashed line back to the tray. */}
      <svg className="lp-drag-line" aria-hidden="true" focusable="false" data-show={dragging ? "" : undefined}>
        <line ref={lineRef} />
      </svg>
      <div ref={ghostRef} className="lp-ghost" aria-hidden="true" data-show={dragging ? "" : undefined}>
        {dragging && (
          <>
            <Avatar person={dragging} size="large" />
            <span>{name(dragging)}</span>
          </>
        )}
      </div>

      <dialog
        ref={dialogRef}
        className="lp-dialog"
        aria-labelledby="lp-note-title"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeNote();
        }}
      >
        <div className="lp-dialog__inner">
          <div className="lp-dialog__head">
            <h3 id="lp-note-title">{c.note.title}</h3>
            <button type="button" className="lp-btn lp-btn--outline lp-btn--small" onClick={closeNote}>
              {c.note.close}
            </button>
          </div>
          <Image
            src={IMAGES.note}
            alt={c.note.imageAlt}
            {...IMAGE_SIZE.note}
            sizes="(min-width: 860px) 44rem, 90vw"
            className="lp-dialog__image"
          />
          <h4 className="lp-dialog__subtitle">{c.note.transcriptTitle}</h4>
          <ul className="lp-dialog__transcript">
            {c.note.transcript.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {c.note.transcriptNote && <p className="lp-dialog__hint">{c.note.transcriptNote}</p>}
        </div>
      </dialog>
    </div>
  );
}

function Avatar({ person, size = "small" }: { person: PersonId; size?: "small" | "large" }) {
  return (
    <span className={`lp-avatar lp-avatar--${size}`}>
      <Image
        src={IMAGES.people[person]}
        alt=""
        {...IMAGE_SIZE.person}
        sizes={size === "large" ? "5rem" : "2.75rem"}
        draggable={false}
      />
    </span>
  );
}

/**
 * One light sweep and three small stars. Plays once when added; callers give it
 * a new key to replay it. Hidden when the visitor asks for reduced motion.
 */
function Flourish() {
  return (
    <span className="lp-celebrate" aria-hidden="true">
      <span className="lp-celebrate__shine" />
      <Sparkle className="lp-celebrate__star lp-celebrate__star--1" />
      <Sparkle className="lp-celebrate__star lp-celebrate__star--2" />
      <Sparkle className="lp-celebrate__star lp-celebrate__star--3" />
    </span>
  );
}

const STICKER_ICON: Record<StickerId, (p: { className?: string }) => ReactNode> = {
  helped: Heart,
  ride: Car,
  hardWork: Sparkle,
};

/** A sent sticker. `popping` plays the short pop and shine; the caller changes its key to replay it. */
function Sticker({ sticker, copy, popping }: { sticker: StickerId; copy: ExampleCopy; popping: boolean }) {
  const Icon = STICKER_ICON[sticker];
  return (
    <span className="lp-sticker" data-sticker={sticker} data-pop={popping ? "" : undefined}>
      <Icon />
      {copy.stickers.label[sticker]}
    </span>
  );
}

/**
 * Thank-you stickers on a finished card: the ones already sent, and for anyone
 * but the owner, 「ありがとうを送る」 with three free stickers. Each person has
 * one sticker per task, which they can change or remove. Exported for the render tests.
 */
export function TaskThanks({
  task,
  actor,
  copy: c,
  idBase,
  thanks,
  pickerOpen,
  pop,
  onOpen,
  onClose,
  onPick,
  onRemove,
}: {
  task: ExampleTask;
  actor: PersonId;
  copy: ExampleCopy;
  idBase: string;
  thanks: ThanksList;
  pickerOpen: boolean;
  pop: { from: PersonId; n: number } | null;
  onOpen: () => void;
  onClose: () => void;
  onPick: (sticker: StickerId) => void;
  onRemove: () => void;
}) {
  const to = thanksRecipient(task, actor);
  if (thanks.length === 0 && !to) return null;
  const title = c.tasks[task.id];
  const mine = thanks.find((t) => t.from === actor) ?? null;
  const pickerId = `${idBase}-${task.id}-stickers`;
  const pickLabelId = `${pickerId}-label`;
  return (
    <div className="lp-thank">
      {thanks.length > 0 && (
        <ul className="lp-thank__list" aria-label={c.stickers.received}>
          {thanks.map((t) => (
            <li key={t.from} className="lp-thank__item">
              <Sticker
                key={pop?.from === t.from ? `pop-${pop.n}` : "still"}
                sticker={t.sticker}
                copy={c}
                popping={pop?.from === t.from}
              />
              <span className="lp-thank__who">{c.stickers.fromTo(c.people[t.from], c.people[t.to])}</span>
              {t.from === actor && (
                <span className="lp-thank__edit">
                  <button
                    type="button"
                    className="lp-btn lp-btn--outline lp-btn--task"
                    data-focus={`${task.id}:thanks-change`}
                    aria-expanded={pickerOpen}
                    aria-controls={pickerOpen ? pickerId : undefined}
                    onClick={pickerOpen ? onClose : onOpen}
                  >
                    {c.stickers.change}
                    <span className="lp-sr">{c.switchContext(title)}</span>
                  </button>
                  <button
                    type="button"
                    className="lp-btn lp-btn--quiet lp-btn--task"
                    data-focus={`${task.id}:thanks-remove`}
                    onClick={onRemove}
                  >
                    {c.stickers.remove}
                    <span className="lp-sr">{c.switchContext(title)}</span>
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {to && !mine && (
        <button
          type="button"
          className="lp-btn lp-btn--outline lp-btn--task lp-thank__send"
          data-focus={`${task.id}:thanks-send`}
          aria-expanded={pickerOpen}
          aria-controls={pickerOpen ? pickerId : undefined}
          onClick={pickerOpen ? onClose : onOpen}
        >
          <Heart />
          {c.stickers.send}
          <span className="lp-sr">{c.stickers.sendContext(c.people[to], title)}</span>
        </button>
      )}
      {to && pickerOpen && (
        <div
          id={pickerId}
          className="lp-thank__picker"
          role="group"
          aria-labelledby={pickLabelId}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onClose();
            }
          }}
        >
          <p id={pickLabelId} className="lp-thank__pick">
            {c.stickers.pick(c.people[to])}
          </p>
          <div className="lp-thank__choices">
            {STICKERS.map((s) => {
              const Icon = STICKER_ICON[s];
              const current = mine?.sticker === s;
              return (
                <button
                  key={s}
                  type="button"
                  className="lp-btn lp-btn--outline lp-btn--task lp-thank__choice"
                  data-sticker={s}
                  data-focus={`${task.id}:sticker:${s}`}
                  aria-pressed={current}
                  onClick={() => onPick(s)}
                >
                  {current ? <Check /> : <Icon />}
                  {c.stickers.label[s]}
                </button>
              );
            })}
            <button type="button" className="lp-btn lp-btn--quiet lp-btn--task" onClick={onClose}>
              {c.stickers.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The family celebration at 4 of 4: Grandma laughing, and each person with what
 * they really did in this run. The flourish plays once, when it appears (that is
 * the fourth completion); reduced motion shows it without the flourish.
 * Exported for the render tests.
 */
export function FamilyParty({
  state,
  copy: c,
  idBase,
  celebration,
  lang = "ja",
  demoConfigured = false,
}: {
  state: ExampleState;
  copy: ExampleCopy;
  idBase: string;
  celebration: number;
  lang?: Language;
  /** True only when the server has a demo account. A flag, never the credentials. */
  demoConfigured?: boolean;
}) {
  const titleId = `${idBase}-party`;
  const { total } = progress(state);
  const did = (item: ContributionItem): string => {
    switch (item.kind) {
      case "finished":
        return c.party.did.finished(c.tasks[item.task]);
      case "drove":
        return c.party.did.drove;
      case "went_along":
        return c.party.did.wentAlong;
      case "confirmed":
        return c.party.did.confirmed;
    }
  };
  return (
    <section className="lp-party" aria-labelledby={titleId}>
      <div className="lp-party__portrait">
        {/* The same laughing photo as above, which already has its description. */}
        <Image src={IMAGES.grandmaByDone[4]} alt="" {...IMAGE_SIZE.grandmaByDone[4]} sizes="7rem" />
        {celebration > 0 && <Flourish key={celebration} />}
      </div>
      <div className="lp-party__text">
        <h4 id={titleId} className="lp-party__title">
          <Sparkle />
          {c.party.title}
        </h4>
        <p>{c.party.lede(total)}</p>
      </div>
      <ul className="lp-party__people" aria-label={c.party.peopleLabel}>
        {contributions(state).map(({ person, items }) => (
          <li key={person} className="lp-party__person">
            <Avatar person={person} />
            <span className="lp-party__name">{c.people[person]}</span>
            <ul className="lp-party__did">
              {items.map((item) => (
                <li key={item.kind === "finished" ? item.task : item.kind}>
                  <Check />
                  {did(item)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="lp-party__next">
        <p>{c.party.next.simulated}</p>
        <Link href={LINKS.login} prefetch={false} className="lp-btn lp-btn--ember lp-btn--large">
          {demoConfigured ? c.party.next.demoCta : c.party.next.realCta}
        </Link>
        <p>{demoConfigured ? c.party.next.demoNote : c.party.next.realNote}</p>
        <Link href={`/demo?lang=${lang}`} prefetch={false} className="lp-example__actualLink">
          {c.party.next.grandma}
        </Link>
      </div>
    </section>
  );
}

/**
 * 「今週のありがとう」: finished tasks per person on this made-up note, read from
 * the tasks every render, so it follows each completion and empties on "Start
 * over". 「ベストサポーター」 goes to each first place only at 4 of 4.
 * Exported for the render tests.
 */
export function ThanksBoard({ state, copy: c }: { state: ExampleState; copy: ExampleCopy }) {
  const rows = leaderboard(state);
  return (
    <section className="lp-thanks" aria-labelledby="lp-thanks-title">
      <h3 id="lp-thanks-title" className="lp-thanks__title">
        <Heart />
        {c.thanks.title}
      </h3>
      <p className="lp-thanks__scope">{c.thanks.scope}</p>
      {rows.length === 0 ? (
        <p className="lp-thanks__empty">{c.thanks.empty}</p>
      ) : (
        <ol className="lp-board" aria-label={c.thanks.listLabel}>
          {rows.map((r) => (
            <li key={r.person} className="lp-board__row" data-best={r.best || undefined}>
              <span className="lp-board__rank">{c.thanks.rank(r.rank, r.tied)}</span>
              <Avatar person={r.person} />
              <span className="lp-board__who">
                <span className="lp-board__name">{c.people[r.person]}</span>
                <span className="lp-board__count">{c.thanks.count(r.done)}</span>
              </span>
              {r.best && (
                <span className="lp-board__best">
                  <Crown />
                  {c.thanks.best}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The hidden part of a button's name that says which task it is for. */
function ButtonLabel({
  label,
  task,
  copy,
  context = copy.taskContext,
}: {
  label: string;
  task: string;
  copy: ExampleCopy;
  context?: ExampleCopy["taskContext"];
}) {
  const { before, after } = context(task);
  return (
    <>
      {before && <span className="lp-sr">{before}</span>}
      {label}
      {after && <span className="lp-sr">{after}</span>}
    </>
  );
}

/**
 * The clinic task's owner types the clinic name they were told. Errors say
 * exactly what is missing, sit next to the field, and keep what was typed.
 */
function ClinicForm({
  copy: c,
  title,
  idBase,
  value,
  error,
  onChange,
  onSample,
  onSubmit,
}: {
  copy: ExampleCopy;
  title: string;
  idBase: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onSample: () => void;
  onSubmit: () => void;
}) {
  const inputId = `${idBase}-clinic`;
  const whyId = `${idBase}-clinic-why`;
  const errorId = `${idBase}-clinic-error`;
  return (
    <form
      className="lp-clinic"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={inputId} className="lp-clinic__label">
        {c.clinicForm.label}
        <span className="lp-clinic__req">{c.clinicForm.required}</span>
      </label>
      <p id={whyId} className="lp-clinic__why">
        {c.clinicForm.why}
      </p>
      <input
        id={inputId}
        type="text"
        className="lp-clinic__input"
        data-focus="clinic:input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${errorId} ${whyId}` : whyId}
        autoComplete="off"
        enterKeyHint="done"
      />
      {error && (
        <p id={errorId} className="lp-clinic__error">
          <RiskMedium />
          {error}
        </p>
      )}
      <div className="lp-clinic__actions">
        <button type="button" className="lp-btn lp-btn--outline lp-btn--task" onClick={onSample}>
          {c.clinicForm.sample}
        </button>
        <button type="submit" className="lp-btn lp-btn--green lp-btn--task">
          <Check />
          <ButtonLabel label={c.clinicForm.save} task={title} copy={c} />
        </button>
      </div>
    </form>
  );
}

/** One task card. Exported for the render tests. */
export function TaskRow({
  task,
  actor,
  lang,
  copy: c,
  riskLabel,
  doneLabel,
  confirmedLabel,
  hospital,
  dragging,
  over,
  onAction,
  onSwitch,
  clinicForm,
  thanksBlock = null,
}: {
  task: ExampleTask;
  actor: PersonId;
  lang: Language;
  copy: ExampleCopy;
  riskLabel: string;
  doneLabel: string;
  confirmedLabel: string;
  hospital: ExampleTask["missingHospital"];
  dragging: PersonId | null;
  over: boolean;
  onAction: (action: Action, id: TaskId) => void;
  onSwitch: (person: PersonId, id: TaskId, then: CardShortcut["then"]) => void;
  clinicForm: ReactNode;
  thanksBlock?: ReactNode;
}) {
  const TaskIcon = TASK_ICON[task.id];
  const RiskIcon = RISK[task.riskLevel].Icon;
  const title = c.tasks[task.id];
  const primaryName = c.people[PRIMARY];
  const available = isAvailable(task, actor);
  const target = dragging !== null && isAvailable(task, dragging);
  const pending = awaitsConfirmation(task);
  const confirmed = isConfirmed(task);
  const completed = task.status === "completed";
  const roles = ROLE_ORDER.filter((r) => r === task.claimRole || task.holders[r] !== null);
  const quote = c.note.transcript[task.noteLine];

  const reasonId = useId();
  const waitId = useId();
  // On the visit, 「完了にする」 is always shown. `canComplete` alone decides whether it works;
  // until then it is disabled, and the reason under it names the first unmet step.
  const lockedComplete = alwaysShowsComplete(task);
  const block = lockedComplete ? completionBlock(task, actor) : null;
  const blockReason =
    block?.kind === "missing"
      ? c.completeBlocked.missing(block.clinic, block.companion)
      : block?.kind === "confirm"
        ? c.completeBlocked.confirm(c.people[block.by])
        : block?.kind === "owner"
          ? c.completeBlocked.owner(block.by ? c.people[block.by] : null)
          : null;
  const shortcut = cardShortcut(task, actor);

  const waiting = waitingOn(task);
  let waitLine: string | null = null;
  if (lockedComplete) {
    // The reason under the button already says what is missing; only the hint to switch person stays here.
    // The 「ミサに切り替える」 button says the same, so the hint only shows without it.
    if (block?.kind === "confirm" && actor !== PRIMARY && !shortcut) waitLine = c.waiting.switchToConfirm(primaryName);
  } else if (waiting?.kind === "clinic") {
    waitLine = c.waiting.clinic(primaryName);
  } else if (waiting?.kind === "confirm" && !canConfirm(task, actor)) {
    waitLine =
      actor === PRIMARY
        ? c.waiting.confirm(primaryName)
        : joinSentences(lang, c.waiting.confirm(primaryName), c.waiting.switchToConfirm(primaryName));
  } else if (waiting?.kind === "owner" && waiting.by !== actor) {
    const owner = c.people[waiting.by];
    waitLine = task.id === "clinic" ? c.waiting.clinicOwner(owner) : c.waiting.owner(owner);
  }

  return (
    <li
      className="lp-task"
      data-drop={task.id}
      data-status={task.status}
      data-mine={isHelper(task, actor) || undefined}
      data-target={target || undefined}
      data-over={over || undefined}
      data-locked-complete={lockedComplete || undefined}
    >
      <span className="lp-task__node" aria-hidden="true">
        {completed && <Check />}
      </span>
      <div className="lp-task__card">
        <span className="lp-task__icon" aria-hidden="true">
          <TaskIcon />
        </span>
        <div className="lp-task__body">
          <h4 className="lp-task__title" tabIndex={-1} data-focus={`${task.id}:title`}>
            {title}
          </h4>
          <p className="lp-task__tags">
            <span className="lp-risk" data-risk={task.riskLevel}>
              <RiskIcon />
              {riskLabel}
            </span>
            {pending && (
              <span className="lp-pill lp-pill--pending">
                <Hourglass />
                {c.status.pending}
              </span>
            )}
            {confirmed && !completed && (
              <span className="lp-pill lp-pill--confirmed">
                <Check />
                {confirmedLabel}
              </span>
            )}
            {completed && (
              <span className="lp-pill lp-pill--done">
                <Check />
                {doneLabel}
              </span>
            )}
          </p>
          {task.askPerson && quote && !completed && (
            <p className="lp-task__source">{c.askFromNote(c.people[task.askPerson], quote)}</p>
          )}
          {hospital &&
            (hospital.name ? (
              <p className="lp-task__fact">
                <Clinic />
                <span>
                  {c.clinicLabel}
                  <strong>{hospital.name}</strong>
                  {hospital.filledBy && c.filledBy(c.people[hospital.filledBy])}
                </span>
              </p>
            ) : (
              task.id === "visit" && (
                <p className="lp-task__missing">
                  <Question />
                  <strong>{c.missingHospital}</strong>
                  <span className="lp-task__ask">{c.askPerson(c.people[hospital.askPerson])}</span>
                </p>
              )
            ))}
          {companionMissing(task) && !completed && (
            <p className="lp-task__missing">
              <Question />
              <strong>{c.missingCompanion}</strong>
            </p>
          )}
          {waitLine && (
            <p id={waitId} className="lp-task__wait">
              {waitLine}
            </p>
          )}
        </div>
        <div className="lp-task__side">
          <dl className="lp-task__people">
            {roles.map((role) => {
              const person = task.holders[role];
              return (
                <div key={role} className="lp-task__role">
                  <dt>{c.roles[role]}</dt>
                  <dd>
                    {person ? (
                      <>
                        <Avatar person={person} />
                        <span className="lp-task__holder">{c.people[person]}</span>
                      </>
                    ) : (
                      <span className="lp-pill lp-pill--unassigned">{c.status.unassigned}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          {/* With a shortcut, the buttons stack, so 「ミサに切り替える」 or 「ケンタに切り替える」 has its own row. */}
          <div className="lp-task__actions" data-stack={shortcut ? "" : undefined}>
            {available && (
              <button
                type="button"
                className="lp-btn lp-btn--navy lp-btn--task"
                data-focus={`${task.id}:claim`}
                onClick={() => onAction("claim", task.id)}
              >
                {task.claimRole === "companion" ? (
                  <ButtonLabel label={c.claimCompanion} task={title} copy={c} context={c.companionContext} />
                ) : (
                  <ButtonLabel label={c.claim} task={title} copy={c} />
                )}
              </button>
            )}
            {canConfirm(task, actor) && (
              <button
                type="button"
                className="lp-btn lp-btn--navy lp-btn--task"
                data-focus={`${task.id}:confirm`}
                onClick={() => onAction("confirm", task.id)}
              >
                <Check />
                <ButtonLabel label={c.confirmAs(primaryName)} task={title} copy={c} />
              </button>
            )}
            {(canComplete(task, actor) || block) && (
              // aria-disabled, not disabled: it stays focusable, so focus can land on it and its reason is read out.
              <button
                type="button"
                className="lp-btn lp-btn--green lp-btn--task"
                data-focus={`${task.id}:complete`}
                aria-disabled={block ? true : undefined}
                aria-describedby={block ? reasonId : undefined}
                onClick={() => {
                  if (!block) onAction("complete", task.id);
                }}
              >
                <Check />
                <ButtonLabel label={c.complete} task={title} copy={c} />
              </button>
            )}
            {shortcut && (
              // The next step on this card, so it is the primary (navy) button.
              <button
                type="button"
                className="lp-btn lp-btn--navy lp-btn--task"
                data-focus={`${task.id}:switch`}
                aria-describedby={blockReason ? reasonId : waitLine ? waitId : undefined}
                onClick={() => onSwitch(shortcut.person, task.id, shortcut.then)}
              >
                {c.switchTo(c.people[shortcut.person])}
                {/* Two cards can offer 「ミサに切り替える」 at once; the hidden task name tells them apart. */}
                <span className="lp-sr">{c.switchContext(title)}</span>
              </button>
            )}
            {canRelease(task, actor) && (
              <button
                type="button"
                className="lp-btn lp-btn--outline lp-btn--task"
                data-focus={`${task.id}:release`}
                onClick={() => onAction("release", task.id)}
              >
                <ButtonLabel label={c.release} task={title} copy={c} />
              </button>
            )}
          </div>
          {blockReason && (
            <p id={reasonId} className="lp-task__reason">
              <Hourglass />
              {blockReason}
            </p>
          )}
        </div>
        {clinicForm}
        {thanksBlock}
        {target && (
          <span className="lp-task__drop" aria-hidden="true">
            <DropIn />
            {c.drop}
            <span className="lp-task__dropRole">{c.roles[task.claimRole]}</span>
          </span>
        )}
      </div>
    </li>
  );
}
