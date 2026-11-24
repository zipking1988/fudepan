"use client";
import { useMemo, useRef, useState } from "react";
import { EventCardView } from "@/app/(family)/family/events/[noteId]/event-card-view";
import type { EventActions } from "@/app/(family)/family/events/[noteId]/event-runner";
import { ReplyButtons } from "@/app/(family)/family/recipient-actions";
import { firstName, GrandmaButtons, GrandmaCard, grandmaSpeech } from "@/app/(family)/family/recipient-view";
import {
  applyDemoAction,
  DEMO_HOUSEHOLD,
  DEMO_MEMBERS,
  DEMO_RECIPIENT,
  initialDemoEvent,
} from "@/lib/family/demo-event";
import { buildEventCard } from "@/lib/family/event-card";
import type { EventViewer, ReceiverOption } from "@/lib/family/event-offers";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import { createTranslator, type Language } from "@/lib/i18n/messages";

/** A fixed "now" (Mon 23 Nov 2026, Tokyo morning) so the demo reads the same every time. */
const NOW = "2026-11-23T01:00:00Z";

const COPY = {
  ja: {
    title: "Fudepan デモ",
    lede: "架空の家族で、手書きメモ1枚がどう進むかを試せます。何も保存せず、だれにも送りません。",
    note: "春子さんのメモ",
    noteText: ["11/27（金）14:30 病院", "保険証", "眼鏡"],
    noteRead: "Fudepan が読み取ったこと：病院の予定、保険証、眼鏡。病院の名前はメモにありません。",
    who: "だれとして操作しますか？",
    reset: "最初からやり直す",
    lang: "English",
    family: "{name} のスマホ（家族）",
    grandma: "春子さんのスマホ",
    grandmaHint: "家族が決めたことが、そのまま大きな文字で出ます。",
    steps: "やってみる順番",
    roles: { primary_caregiver: "主介護者（大事なことを確認する人）", family_member: "家族" } as Record<string, string>,
    step: [
      "Kenta で「🏥 病院を知っています」を押し、病院の名前を入れて保存。春子さんの画面に 14:30 が大きく出ます。",
      "Kenta で「🚗 運転します」。次に Yui に切り替えて「付き添います」。",
      "「保険証」と「眼鏡」の「やります」を、だれかが押します。",
      "Misa に切り替えて「✅ 確認しました」。病院や送迎は、主介護者の確認が必要です。",
      "Kenta に戻って「✔ 終わりました」。",
      "Yui に切り替えて、保険証と眼鏡も「✔ 終わりました」。ぜんぶ終わると、春子さんの画面に ✅ が出ます。",
    ],
    allDone: "ぜんぶ試せました。「最初からやり直す」で、もう一度できます。",
    done: "できた",
  },
  en: {
    title: "Fudepan demo",
    lede: "A made-up family shows how one handwritten note moves along. Nothing is saved or sent.",
    note: "Haruko's note",
    noteText: ["11/27 (Fri) 14:30 clinic", "insurance card", "glasses"],
    noteRead: "What Fudepan read: a clinic visit, the insurance card, the glasses. The note does not say which clinic.",
    who: "Who are you in the demo?",
    reset: "Start over",
    lang: "日本語",
    family: "{name}'s phone (family)",
    grandma: "Haruko's phone",
    grandmaHint: "What the family decides shows up here, in big letters.",
    steps: "Try it in this order",
    roles: { primary_caregiver: "Primary caregiver (confirms important things)", family_member: "Family" } as Record<string, string>,
    step: [
      "As Kenta, tap “🏥 I know the clinic”, type the clinic name and save. Haruko's screen now shows 14:30 in big numbers.",
      "As Kenta, tap “🚗 I'll drive”. Then switch to Yui and tap “I'll go along”.",
      "Someone taps “I'll do it” on the insurance card and the glasses.",
      "Switch to Misa and tap “✅ Confirmed”. Clinic visits and rides need the primary caregiver's confirmation.",
      "Back as Kenta, tap “✔ Done”.",
      "Switch to Yui and tap “✔ Done” for the insurance card and the glasses. When everything is done, Haruko sees ✅.",
    ],
    allDone: "You tried everything. “Start over” runs it again.",
    done: "done",
  },
} as const;

const RECIPIENT_OPTION: ReceiverOption = { id: DEMO_RECIPIENT.id, name: DEMO_RECIPIENT.name, role: "care_recipient" };
const ALL_MEMBERS = [...DEMO_MEMBERS, RECIPIENT_OPTION];

/** Which of the five steps are done, read from the event itself. */
export function demoProgress(event: SharedCareEvent): boolean[] {
  const visit = event.parts.find((p) => p.careCategory === "appointment");
  const others = event.parts.filter((p) => p !== visit);
  return [
    Boolean(visit?.location && visit.confirmed.appointment),
    Boolean(visit?.driver && visit.companion),
    others.every((p) => p.owner !== null),
    visit?.approvalState === "approved" || visit?.progressStatus === "completed",
    visit?.progressStatus === "completed",
    event.done,
  ];
}

export function DemoBoard({ initialLanguage = "ja" }: { initialLanguage?: Language }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [event, setEvent] = useState<SharedCareEvent>(() => initialDemoEvent(initialLanguage));
  const [viewerId, setViewerId] = useState(DEMO_MEMBERS[1].id);
  const [memoSaid, setMemoSaid] = useState(false);
  const [round, setRound] = useState(0);
  // The latest event for the actions; updated in the same place as the state.
  const eventRef = useRef(event);

  const copy = COPY[language];
  const tr = createTranslator(language);
  const viewerMember = DEMO_MEMBERS.find((m) => m.id === viewerId) ?? DEMO_MEMBERS[1];
  const viewer: EventViewer = { memberId: viewerMember.id, householdId: DEMO_HOUSEHOLD, role: viewerMember.role };

  const actions = useMemo(() => {
    const run = (name: string) => async (input: unknown) => {
      const result = applyDemoAction(eventRef.current, viewer, name, (input ?? {}) as Record<string, unknown>);
      if (!result.ok) return { ok: false as const, messageKey: result.messageKey, params: {} };
      eventRef.current = result.event;
      setEvent(result.event);
      return { ok: true as const, messageKey: result.messageKey };
    };
    return new Proxy({} as EventActions, {
      get: (_, name: string) => {
        if (name === "prepareEvidenceUpload") return async () => ({ ok: false, messageKey: "demo.notInDemo", params: {} });
        if (name === "uploadEvidenceFile") return async () => false;
        return run(name);
      },
    });
    // The viewer is part of the key below, so a new set of actions is made for each person.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.memberId]);

  function reset(lang: Language = language) {
    const fresh = initialDemoEvent(lang);
    eventRef.current = fresh;
    setEvent(fresh);
    setViewerId(DEMO_MEMBERS[1].id);
    setMemoSaid(false);
    setRound((r) => r + 1);
  }
  function switchLanguage() {
    const next: Language = language === "ja" ? "en" : "ja";
    setLanguage(next);
    reset(next);
  }

  const progress = demoProgress(event);
  const current = progress.findIndex((d) => !d);
  const card = buildEventCard(event);
  const name = firstName(DEMO_RECIPIENT.name);

  return (
    <div className="demo grid gap-8" lang={language}>
      <header className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="demo__title">{copy.title}</h1>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="demo__chip" onClick={switchLanguage}>
              🌐 {copy.lang}
            </button>
            <button type="button" className="demo__chip" onClick={() => reset()}>
              ↺ {copy.reset}
            </button>
          </div>
        </div>
        <p className="text-lg text-stone-700">{copy.lede}</p>
      </header>

      <div className="demo__intro">
        <figure className="demo__note" aria-labelledby="demo-note-caption">
          <figcaption id="demo-note-caption" className="text-base font-semibold text-stone-600">
            📝 {copy.note}
          </figcaption>
          <ul className="demo__noteText">
            {copy.noteText.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-base text-stone-700">{copy.noteRead}</p>
        </figure>

        <section aria-labelledby="demo-steps" className="demo__steps">
          <h2 id="demo-steps" className="text-xl font-bold">
            {copy.steps}
          </h2>
          <ol className="grid gap-2">
            {copy.step.map((text, i) => {
              const state = progress[i] ? "done" : i === current ? "now" : "later";
              return (
                <li key={text} className="demo__step" data-state={state} aria-current={state === "now" ? "step" : undefined}>
                  <span className="demo__stepNum" aria-hidden="true">
                    {progress[i] ? "✓" : i + 1}
                  </span>
                  <span>
                    {text}
                    {progress[i] && <span className="sr-only"> ({copy.done})</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {current === -1 && (
            <p className="app-success" role="status">
              {copy.allDone}
            </p>
          )}
        </section>
      </div>

      <section aria-labelledby="demo-who" className="grid gap-3">
        <h2 id="demo-who" className="text-xl font-bold">
          {copy.who}
        </h2>
        <div className="flex flex-wrap gap-3" role="group" aria-labelledby="demo-who">
          {DEMO_MEMBERS.map((m) => (
            <button
              key={m.id}
              type="button"
              className="demo__person"
              aria-pressed={m.id === viewerId}
              onClick={() => setViewerId(m.id)}
            >
              <span className="demo__face" aria-hidden="true">
                {m.name.charAt(0)}
              </span>
              <span className="grid text-left">
                <span className="text-lg font-bold">{m.name}</span>
                <span className="text-sm text-stone-600">{copy.roles[m.role] ?? copy.roles.family_member}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="demo__phones">
        <section aria-labelledby="demo-family" className="grid content-start gap-3">
          <h2 id="demo-family" className="demo__phoneLabel">
            📱 {copy.family.replace("{name}", viewerMember.name)}
          </h2>
          <div className="demo__phone app-shell">
            <EventCardView
              key={`${viewerId}-${round}-${language}`}
              event={event}
              viewer={viewer}
              members={ALL_MEMBERS}
              language={language}
              nowIso={NOW}
              timeline={[]}
              viewerName={viewerMember.name}
              recipientName={DEMO_RECIPIENT.name}
              photoSrc="/demo/note.svg"
              actions={actions}
              onChanged={() => {}}
            />
          </div>
        </section>

        <section aria-labelledby="demo-grandma" className="grid content-start gap-3">
          <h2 id="demo-grandma" className="demo__phoneLabel">
            👵 {copy.grandma}
          </h2>
          <p className="text-base text-stone-600">{copy.grandmaHint}</p>
          <div className="demo__phone family-recipient family-assistant grid gap-6">
            <div className="grandma-card grid gap-6">
              {event.done ? (
                <div className="grid gap-4 text-center">
                  <h3 className="grandma-card__name">{tr.t("grandma.name", { name })}</h3>
                  <p className="grandma-card__hero">
                    <span aria-hidden="true" className="text-6xl">
                      ✅
                    </span>
                    <span className="grandma-card__what">{tr.t("recipient.allDone")}</span>
                  </p>
                </div>
              ) : card.main ? (
                <GrandmaCard event={event} language={language} name={name} />
              ) : (
                <p className="text-2xl">{tr.t("recipient.allDone")}</p>
              )}
              <GrandmaButtons
                text={grandmaSpeech(event, language)}
                language={language}
                onMemo={() => setMemoSaid(true)}
              />
              <div role="status" aria-live="polite">
                {memoSaid && <p className="app-success text-xl">{tr.t("demo.memo")}</p>}
              </div>
            </div>
            <ReplyButtons key={`reply-${round}-${language}`} noteId={event.noteId} language={language} demo />
          </div>
        </section>
      </div>
    </div>
  );
}
