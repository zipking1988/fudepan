"use client";

import { useState } from "react";
import { labelMessageKey } from "@/lib/care/rules/labels";
import { computeOffers } from "@/lib/family/event-offers";
import { buildEventCard, type CardSlot, type CardStage } from "@/lib/family/event-card";
import { DateTile, ICON, initial, shortName, timeText } from "../../card-parts";
import type { EventPart } from "@/lib/family/shared-care-event";
import { createTranslator, type MessageKey, type Translator } from "@/lib/i18n/messages";
import { useRunner, type Runner } from "./event-runner";
import { AppointmentForm } from "./part-forms";
import { ThreadView, type ThreadViewProps } from "./thread-view";

/**
 * The event as one glance: a big date, the time, the place, faces for who is
 * going, icons for the other things, and one-tap buttons. Everything else
 * (the conversation, every option, the history) is under "More details".
 */
const SLOT_ICON = { driver: "🚗", companion: "🧑‍🤝‍🧑", owner: "✋" } as const;
function Face({ slot, viewerId, tr }: { slot: CardSlot; viewerId: string; tr: Translator }) {
  const m = slot.member;
  const mine = m?.id === viewerId;
  const label = m
    ? `${tr.t(`card.slot.${slot.role}` as MessageKey)}: ${mine ? tr.t("card.slot.you") : shortName(m.name) || tr.t("thread.someone")}`
    : tr.t(`card.slot.${slot.role}.empty` as MessageKey);
  return (
    <li className="grid justify-items-center gap-1 text-center">
      <span className={`family-card__face ${m ? "" : "family-card__face--empty"}`} aria-hidden="true">
        {m ? initial(shortName(m.name)) : SLOT_ICON[slot.role]}
      </span>
      <span className={`text-sm leading-tight ${m ? "" : "font-semibold text-[#a9431f]"}`}>
        {m ? (mine ? tr.t("card.slot.you") : shortName(m.name)) : tr.t(`card.slot.${slot.role}.empty` as MessageKey)}
      </span>
      <span className="sr-only">{label}</span>
    </li>
  );
}

const STAGES: CardStage[] = ["reading", "people", "confirm", "ready"];

export function ProgressDots({ stage, tr }: { stage: CardStage; tr: Translator }) {
  const at = stage === "done" ? STAGES.length : STAGES.indexOf(stage);
  const labels = [tr.t("card.stage.read"), tr.t("card.stage.people"), tr.t("card.stage.confirm"), tr.t("card.stage.done")];
  return (
    <ol className="family-card__progress" aria-label={tr.t("card.stage.label")}>
      {labels.map((label, i) => {
        const state = i < at ? "done" : i === at ? "now" : "later";
        return (
          <li key={label} data-state={state} aria-current={state === "now" ? "step" : undefined}>
            <span aria-hidden="true">{state === "done" ? "✓" : ""}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

function BigButton({
  icon,
  label,
  runner,
  onClick,
  quiet,
}: {
  icon: string;
  label: string;
  runner: Runner;
  onClick: () => void;
  quiet?: boolean;
}) {
  return (
    <button
      type="button"
      className={`family-card__action ${quiet ? "family-card__action--quiet" : ""}`}
      disabled={runner.pending}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span> {label}
    </button>
  );
}

function Message({ runner }: { runner: Runner }) {
  return (
    <>
      <div role="status" aria-live="polite">
        {runner.message?.kind === "status" && <p className="app-success">{runner.message.text}</p>}
      </div>
      <div role="alert">{runner.message?.kind === "alert" && <p className="app-alert">{runner.message.text}</p>}</div>
    </>
  );
}

function ItemTile({ part, props, tr, done }: { part: EventPart; props: ThreadViewProps; tr: Translator; done: boolean }) {
  const runner = useRunner(tr, props.onChanged);
  const offers = computeOffers(part, props.viewer, props.members, new Date(props.nowIso));
  const card = buildEventCard({ ...props.event, parts: [part] });
  const icon = card.main?.icon ?? "home";
  return (
    <li className={`family-card__item ${done ? "family-card__item--done" : ""}`}>
      <span className="text-4xl" aria-hidden="true">
        {done ? "✅" : ICON[icon]}
      </span>
      <span className="family-card__itemTitle">{part.title}</span>
      <span className="text-sm">
        {part.owner ? (
          <>
            <span className="family-card__mini" aria-hidden="true">
              {initial(shortName(part.owner.name))}
            </span>{" "}
            {part.owner.id === props.viewer.memberId ? tr.t("card.slot.you") : shortName(part.owner.name)}
          </>
        ) : (
          <span className="font-semibold text-[#a9431f]">{tr.t("card.item.nobody")}</span>
        )}
      </span>
      {!done && offers.claim.includes("owner") && (
        <button
          type="button"
          className="family-card__small"
          disabled={runner.pending}
          onClick={() => runner.run(() => props.actions.claimPart({ stepId: part.id, role: "owner" }))}
        >
          {tr.t("card.item.take")}
        </button>
      )}
      <Message runner={runner} />
    </li>
  );
}

export function EventCardView(props: ThreadViewProps) {
  const { event, viewer, members, language, nowIso, actions, onChanged } = props;
  const tr = createTranslator(language);
  const runner = useRunner(tr, onChanged);
  const [placeOpen, setPlaceOpen] = useState(false);
  const card = buildEventCard(event);
  const mainPart = card.main ? event.parts.find((p) => p.id === card.main!.partId) ?? null : null;
  const offers = mainPart ? computeOffers(mainPart, viewer, members, new Date(nowIso)) : null;
  const canAct = viewer.role !== "care_recipient";
  const main = card.main;
  const time = main ? timeText(main.when) : null;

  return (
    <div className="grid gap-6">
      {event.state !== "ready" || !main || !mainPart ? (
        <section className="family-card grid gap-4" aria-live="polite">
          <p className="text-2xl font-bold">{tr.t("card.reading")}</p>
          <ProgressDots stage="reading" tr={tr} />
        </section>
      ) : (
        <section className="family-card grid gap-6" aria-labelledby="card-title">
          <div className="flex items-start gap-4">
            <DateTile when={main.when} language={language} dateUnknown={main.prompts.dateUnknown} />
            <div className="grid min-w-0 gap-1">
              <h1 id="card-title" className="family-card__what">
                <span aria-hidden="true">{ICON[main.icon]}</span> {tr.t(`card.icon.${main.icon}` as MessageKey)}
                {time && <span className="family-card__time"> {time}</span>}
              </h1>
              {main.when.kind === "fromNote" && <p className="family-card__check">{tr.t("card.fromNote")}</p>}
              {main.awaitingConfirmation && (
                <p className="family-card__check">
                  <span aria-hidden="true">🔒</span> {tr.t(labelMessageKey("requiresConfirmation"))}
                </p>
              )}
              {main.status === "completed" && (
                <p className="family-card__check">
                  <span aria-hidden="true">✅</span> {tr.t("label.done")}
                </p>
              )}
              {main.prompts.timeUnknown && <p className="family-card__check">{tr.t("card.timeUnknown")}</p>}
              {main.place ? (
                <p className="text-lg font-semibold">📍 {main.place}</p>
              ) : !main.prompts.placeUnknown ? null : (
                <p className="text-lg font-bold text-[#a9431f]">
                  ❓ {tr.t("card.place.unknown")}
                  {main.askPerson && (
                    <span className="block text-base font-normal text-stone-700">
                      {tr.t("card.place.ask", { name: main.askPerson })}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>

          <ul className="family-card__faces" aria-label={tr.t("card.who")}>
            {main.slots.map((slot) => (
              <Face key={slot.role} slot={slot} viewerId={viewer.memberId} tr={tr} />
            ))}
          </ul>

          {canAct && offers && !main.done && (
            <div className="grid gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {offers.claim.includes("driver") && (
                  <BigButton
                    icon="🚗"
                    label={tr.t("card.btn.drive")}
                    runner={runner}
                    onClick={() => runner.run(() => actions.claimPart({ stepId: mainPart.id, role: "driver" }))}
                  />
                )}
                {offers.claim.includes("companion") && (
                  <BigButton
                    icon="🧑‍🤝‍🧑"
                    label={tr.t("card.btn.goAlong")}
                    runner={runner}
                    onClick={() => runner.run(() => actions.claimPart({ stepId: mainPart.id, role: "companion" }))}
                  />
                )}
                {offers.claim.includes("owner") && (
                  <BigButton
                    icon="✋"
                    label={tr.t("card.btn.handle")}
                    runner={runner}
                    onClick={() => runner.run(() => actions.claimPart({ stepId: mainPart.id, role: "owner" }))}
                  />
                )}
                {offers.approve && (
                  <BigButton
                    icon="✅"
                    label={tr.t("card.btn.confirm")}
                    runner={runner}
                    onClick={() => runner.run(() => actions.decideApproval({ stepId: mainPart.id, decision: "approve" }))}
                  />
                )}
                {offers.complete && (
                  <BigButton
                    icon="✔️"
                    label={tr.t("card.btn.done")}
                    runner={runner}
                    onClick={() => runner.run(() => actions.completePart({ stepId: mainPart.id }))}
                  />
                )}
              </div>
              {!main.place && mainPart.careCategory === "appointment" && (
                <>
                  <BigButton
                    icon="🏥"
                    label={tr.t("card.btn.knowPlace")}
                    runner={runner}
                    quiet
                    onClick={() => setPlaceOpen((open) => !open)}
                  />
                  {placeOpen && (
                    <div className="rounded-2xl border-2 border-stone-300 bg-white p-4">
                      <AppointmentForm part={mainPart} tr={tr} runner={runner} actions={actions} />
                    </div>
                  )}
                </>
              )}
              <Message runner={runner} />
            </div>
          )}

          {card.items.length > 0 && (
            <div className="grid gap-3">
              <h2 className="text-base font-semibold text-stone-600">{tr.t("card.items")}</h2>
              <ul className="family-card__items">
                {card.items.map((item) => {
                  const part = event.parts.find((p) => p.id === item.partId);
                  return part ? <ItemTile key={item.partId} part={part} props={props} tr={tr} done={item.done} /> : null;
                })}
              </ul>
            </div>
          )}

          <ProgressDots stage={card.stage} tr={tr} />
        </section>
      )}

      <details className="family-card__more">
        <summary>{tr.t("card.more")}</summary>
        <div className="mt-4">
          <ThreadView {...props} embedded />
        </div>
      </details>
    </div>
  );
}
