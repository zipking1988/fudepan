"use client";

import type { ReactNode } from "react";

import { LocalDateTime } from "@/components/app/local-date-time";
import { approvalLabelKey, labelMessageKey, riskLabelKey } from "@/lib/care/rules/labels";
import type { HelperRole } from "@/lib/care/rules/types";
import { computeOffers, type EventViewer, type ReceiverOption } from "@/lib/family/event-offers";
import type {
  EventPart,
  EventTime,
  MemberRef,
  MissingDetailView,
  PendingRequestView,
} from "@/lib/family/shared-care-event";
import { formatDateTimeInZone, formatList, type Language } from "@/lib/i18n/format";
import { createTranslator, isMessageKey, type MessageKey, type Translator } from "@/lib/i18n/messages";

import { useRunner, type EventActions, type Runner } from "./event-runner";
import {
  AnswerForm,
  AmountForm,
  AppointmentForm,
  DeadlineForm,
  EvidenceForm,
  PersonForm,
  ResubmitForm,
} from "./part-forms";

export type PartCardProps = {
  part: EventPart;
  viewer: EventViewer;
  /** Active members of the household, for hand over, assignment, and backup choices. */
  members: readonly ReceiverOption[];
  language: Language;
  /** The moment the page was read. Used only to decide which buttons the rules allow. */
  nowIso: string;
  actions: EventActions;
  /** Called after an action worked, to re-read the page. */
  onChanged: () => void;
};

function memberName(tr: Translator, ref: MemberRef, viewerId: string): string {
  const name = ref.name?.trim() || tr.t("event.helper.someone");
  return ref.id === viewerId ? `${name} (${tr.t("event.helper.you")})` : name;
}

function timeText(t: EventTime | null, tr: Translator): string {
  if (!t) return tr.t("event.time.notSet");
  try {
    return formatDateTimeInZone(new Date(t.at), t.timeZone, tr.lang);
  } catch {
    return tr.t("event.time.notSet");
  }
}

function lookupKey(prefix: string, code: string, fallback: MessageKey): MessageKey {
  const key = `${prefix}${code}`;
  return isMessageKey(key) ? key : fallback;
}

function Message({ runner }: { runner: Runner }) {
  return (
    <>
      <div role="status" aria-live="polite">
        {runner.message?.kind === "status" && <p className="app-success">{runner.message.text}</p>}
      </div>
      <div role="alert">
        {runner.message?.kind === "alert" && <p className="app-alert">{runner.message.text}</p>}
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h4 className="text-lg font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function requestSentence(tr: Translator, r: PendingRequestView, viewerId: string): string {
  const from = memberName(tr, r.from, viewerId);
  if (r.kind === "backup") return tr.t("event.request.backup", { from });
  if (r.kind === "handover") {
    const role = r.helperRole && isMessageKey(`role.${r.helperRole}`)
      ? tr.t(`role.${r.helperRole}` as MessageKey)
      : tr.t("role.owner");
    return tr.t("event.request.handover", { from, role });
  }
  return tr.t("event.request.assignment", { from });
}

function MissingBlock({
  part,
  tr,
  runner,
  actions,
  canAnswer,
}: {
  part: EventPart;
  tr: Translator;
  runner: Runner;
  actions: EventActions;
  canAnswer: boolean;
}) {
  const details = part.missingDetails;
  if (details.length === 0) return null;
  const appointmentCodes = new Set(["which_clinic", "which_date", "which_time"]);
  const derivedAppointment = details.some(
    (d) => d.storedDetailId === null && appointmentCodes.has(d.questionCode),
  );
  const derivedAmount = details.some((d) => d.storedDetailId === null && d.questionCode === "which_amount");
  const derivedDeadline = details.some((d) => d.storedDetailId === null && d.questionCode === "when_is_deadline");

  const question = (d: MissingDetailView): string =>
    d.questionCode === "ai_question" && d.aiQuestion
      ? d.aiQuestion
      : tr.t(lookupKey("missing.question.", d.questionCode, "missing.question.ai_question"));

  return (
    <Section title={tr.t("event.missing.heading")}>
      <ul className="grid gap-3">
        {details.map((d) => (
          <li key={d.key} className="grid gap-2 rounded border-2 border-amber-500 bg-amber-50 p-3">
            <p className="font-semibold">{question(d)}</p>
            <p className="app-hint">
              {tr.t("event.missing.why", {
                reason: tr.t(lookupKey("", d.reasonCode, "missing.reason.person")),
              })}
            </p>
            {d.personToAsk && <p className="app-hint">{tr.t("event.askPerson", { name: d.personToAsk })}</p>}
            {d.questionCode === "who_will_drive" && <p className="app-hint">{tr.t("event.missing.driverHint")}</p>}
            {canAnswer && d.storedDetailId !== null && (
              <AnswerForm detail={d} tr={tr} runner={runner} actions={actions} />
            )}
          </li>
        ))}
      </ul>
      {canAnswer && derivedAppointment && (
        <AppointmentForm part={part} tr={tr} runner={runner} actions={actions} />
      )}
      {canAnswer && derivedAmount && <AmountForm part={part} tr={tr} runner={runner} actions={actions} />}
      {canAnswer && derivedDeadline && <DeadlineForm part={part} tr={tr} runner={runner} actions={actions} />}
    </Section>
  );
}

/** One Part. Every button shown here is one the rule module allows this person to use. */
export function PartCard({ part, viewer, members, language, nowIso, actions, onChanged }: PartCardProps) {
  const tr = createTranslator(language);
  const runner = useRunner(tr, onChanged);
  const offers = computeOffers(part, viewer, members, new Date(nowIso));

  const closed = part.progressStatus === "completed" || part.progressStatus === "cancelled";
  const riskKey = riskLabelKey(part.riskLevel);
  const approvalKey = approvalLabelKey({ progressStatus: part.progressStatus, approvalState: part.approvalState });
  const progressKey = lookupKey("event.progress.", part.progressStatus, "event.progress.other");
  const travel = part.careCategory === "appointment" || part.careCategory === "transport";
  const canWrite = viewer.role !== "care_recipient" && !closed;
  const receivers = offers.receivers.map((r) => ({ id: r.id, name: r.name }));
  const roleName = (role: HelperRole) => tr.t(`role.${role}` as MessageKey);
  const headingId = `part-${part.id}`;

  const holders: { label: string; ref: MemberRef | null }[] = [
    { label: tr.t("role.owner"), ref: part.owner },
    ...(travel
      ? [
          { label: tr.t("role.driver"), ref: part.driver },
          { label: tr.t("role.companion"), ref: part.companion },
        ]
      : []),
    { label: tr.t("role.backup"), ref: part.backup },
  ];

  const pendingForMe = offers.respond;
  const pendingOthers = part.pendingRequests.filter((r) => !pendingForMe.some((m) => m.id === r.id));

  const needsSomeone = part.owner === null && !closed;

  return (
    <article
      aria-labelledby={headingId}
      className="grid gap-4 rounded-md border-2 border-stone-400 bg-white p-4 text-lg sm:p-5"
    >
      <header className="grid gap-2">
        <h3 id={headingId} className="text-xl font-bold">
          {part.title}
        </h3>
        <ul className="flex flex-wrap gap-2" aria-label={tr.t("event.part.progress")}>
          <li className="app-status">{tr.t(labelMessageKey(riskKey))}</li>
          {approvalKey && <li className="app-status">{tr.t(labelMessageKey(approvalKey))}</li>}
          <li className="app-status">{tr.t(progressKey)}</li>
          {needsSomeone && <li className="app-status">{tr.t("event.part.needsSomeone")}</li>}
        </ul>
        {part.description && <p>{part.description}</p>}
      </header>

      {part.sourceQuote && (
        <Section title={tr.t("event.part.fromNote")}>
          <blockquote className="border-l-4 border-stone-400 pl-3 whitespace-pre-wrap">{part.sourceQuote}</blockquote>
        </Section>
      )}

      <Section title={tr.t("event.part.helpers")}>
        <ul className="grid gap-1">
          {holders.map((h) => (
            <li key={h.label}>
              {tr.t("event.helper.line", {
                role: h.label,
                name: h.ref ? memberName(tr, h.ref, viewer.memberId) : tr.t("role.nobody"),
              })}
            </li>
          ))}
        </ul>
        {part.suggestedRole && <p className="app-hint">{tr.t("event.suggestedRole", { role: part.suggestedRole })}</p>}
        {part.personToAsk && <p className="app-hint">{tr.t("event.askPerson", { name: part.personToAsk })}</p>}
      </Section>

      {(pendingForMe.length > 0 || pendingOthers.length > 0) && (
        <Section title={tr.t("event.request.heading")}>
          <ul className="grid gap-3">
            {pendingForMe.map((r) => (
              <li key={r.id} className="grid gap-2 rounded border-2 border-stone-400 p-3">
                <p>{requestSentence(tr, r, viewer.memberId)}</p>
                <p className="app-hint">
                  {tr.t("event.request.expires")} <LocalDateTime iso={r.expiresAt} lang={tr.lang} />.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="app-button"
                    disabled={runner.pending}
                    onClick={() => runner.run(() => actions.respondToRequest({ requestId: r.id, accept: true }))}
                  >
                    {tr.t("event.btn.accept")}
                  </button>
                  <button
                    type="button"
                    className="app-button app-button--quiet"
                    disabled={runner.pending}
                    onClick={() => runner.run(() => actions.respondToRequest({ requestId: r.id, accept: false }))}
                  >
                    {tr.t("event.btn.decline")}
                  </button>
                </div>
              </li>
            ))}
            {pendingOthers.map((r) => (
              <li key={r.id}>
                {tr.t("event.request.other", {
                  from: memberName(tr, r.from, viewer.memberId),
                  to: memberName(tr, r.to, viewer.memberId),
                })}{" "}
                <LocalDateTime iso={r.expiresAt} lang={tr.lang} />.
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={tr.t("event.time.heading")}>
        <dl className="grid gap-1">
          <div>
            <dt className="font-semibold">{tr.t("event.time.appointment")}</dt>
            <dd>{timeText(part.confirmed.appointment, tr)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{tr.t("event.time.respondBy")}</dt>
            <dd>{timeText(part.confirmed.respondBy, tr)}</dd>
          </div>
          <div>
            <dt className="font-semibold">{tr.t("event.time.taskDue")}</dt>
            <dd>{timeText(part.confirmed.taskDue, tr)}</dd>
          </div>
          {part.careCategory === "appointment" && (
            <div>
              <dt className="font-semibold">{tr.t("event.part.location")}</dt>
              <dd>{part.location ?? tr.t("event.part.noLocation")}</dd>
            </div>
          )}
        </dl>
        {!closed && (
          <p className="app-hint">
            {part.confirmed.taskDue ? tr.t("event.ifNobody") : tr.t("event.ifNobody.noDeadline")}
          </p>
        )}
      </Section>

      <Section title={tr.t("event.evidence.heading")}>
        <p>
          {part.evidence.required.length > 0
            ? tr.t("event.evidence.required", { list: formatList(part.evidence.required, tr.lang) })
            : tr.t("event.evidence.noneRequired")}
        </p>
        <p>
          {part.evidence.attachedCount > 0
            ? tr.tCount("event.evidence.attached", part.evidence.attachedCount)
            : tr.t("event.evidence.none")}
        </p>
        {part.evidence.attached.length > 0 && (
          <ul className="list-disc pl-6">
            {part.evidence.attached.map((e) => (
              <li key={e.id}>{e.label}</li>
            ))}
          </ul>
        )}
        {offers.addEvidence && (
          <details>
            <summary className="app-link min-h-12 cursor-pointer py-2">{tr.t("event.evidence.heading")}</summary>
            <EvidenceForm part={part} tr={tr} runner={runner} actions={actions} />
          </details>
        )}
      </Section>

      <MissingBlock
        part={part}
        tr={tr}
        runner={runner}
        actions={actions}
        canAnswer={canWrite}
      />

      {part.approvalState === "rejected" && !closed && <p className="app-alert">{tr.t("event.approval.rejected")}</p>}

      {offers.resubmit && <ResubmitForm part={part} tr={tr} runner={runner} actions={actions} />}

      {!offers.none && (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-3">
            {offers.claim.map((role) => (
              <button
                key={`claim-${role}`}
                type="button"
                className="app-button"
                disabled={runner.pending}
                onClick={() => runner.run(() => actions.claimPart({ stepId: part.id, role }))}
              >
                {tr.t(`event.btn.claim.${role}` as MessageKey)}
              </button>
            ))}
            {offers.volunteerBackup && (
              <button
                type="button"
                className="app-button app-button--quiet"
                disabled={runner.pending}
                onClick={() => runner.run(() => actions.volunteerBackup({ stepId: part.id }))}
              >
                {tr.t("event.btn.backup.volunteer")}
              </button>
            )}
            {offers.release.map((role) => (
              <button
                key={`release-${role}`}
                type="button"
                className="app-button app-button--quiet"
                disabled={runner.pending}
                onClick={() => runner.run(() => actions.releasePart({ stepId: part.id, role }))}
              >
                {tr.t("event.btn.release", { role: roleName(role) })}
              </button>
            ))}
            {offers.approve && (
              <button
                type="button"
                className="app-button"
                disabled={runner.pending}
                onClick={() => runner.run(() => actions.decideApproval({ stepId: part.id, decision: "approve" }))}
              >
                {tr.t("event.btn.approve")}
              </button>
            )}
            {offers.reject && (
              <button
                type="button"
                className="app-button app-button--quiet"
                disabled={runner.pending}
                onClick={() => runner.run(() => actions.decideApproval({ stepId: part.id, decision: "reject" }))}
              >
                {tr.t("event.btn.reject")}
              </button>
            )}
            {offers.complete && (
              <button
                type="button"
                className="app-button"
                disabled={runner.pending}
                onClick={() => runner.run(() => actions.completePart({ stepId: part.id }))}
              >
                {tr.t("event.btn.complete")}
              </button>
            )}
            {offers.fail && (
              <button
                type="button"
                className="app-button app-button--quiet"
                disabled={runner.pending}
                onClick={() => runner.run(() => actions.reportPartFailed({ stepId: part.id }))}
              >
                {tr.t("event.btn.fail")}
              </button>
            )}
            {offers.reopen && (
              <button
                type="button"
                className="app-button"
                disabled={runner.pending}
                onClick={() => runner.run(() => actions.reopenPart({ stepId: part.id }))}
              >
                {tr.t("event.btn.reopen")}
              </button>
            )}
          </div>

          {(offers.approve || offers.reject) && offers.selfApprovalNote && (
            <p className="app-hint">{tr.t("event.approval.note")}</p>
          )}
          {offers.completeWaiting && <p className="app-hint">{tr.t("event.completeWaiting")}</p>}
          {offers.releaseBlocked.length > 0 && <p className="app-hint">{tr.t("event.releaseBlocked")}</p>}
          {offers.backupPrompt && <p className="app-hint">{tr.t("event.backupPrompt")}</p>}

          {offers.handover.map((role) => (
            <details key={`handover-${role}`}>
              <summary className="app-link min-h-12 cursor-pointer py-2">{tr.t("event.btn.handover")}</summary>
              <PersonForm
                label={tr.t("event.btn.handover.choose", { role: roleName(role) })}
                button={tr.t("event.btn.handover.send")}
                receivers={receivers}
                tr={tr}
                runner={runner}
                onSubmit={(toMemberId) => actions.requestHandover({ stepId: part.id, role, toMemberId })}
              />
            </details>
          ))}
          {offers.requestAssignment && (
            <PersonForm
              label={tr.t("event.btn.assign.label")}
              button={tr.t("event.btn.assign.send")}
              receivers={receivers}
              tr={tr}
              runner={runner}
              onSubmit={(toMemberId) => actions.requestAssignment({ stepId: part.id, toMemberId })}
            />
          )}
          {offers.requestBackup && (
            <PersonForm
              label={tr.t("event.btn.backup.label")}
              button={tr.t("event.btn.backup.send")}
              receivers={receivers.filter((r) => r.id !== part.owner?.id)}
              tr={tr}
              runner={runner}
              onSubmit={(toMemberId) => actions.requestBackup({ stepId: part.id, toMemberId })}
            />
          )}
        </div>
      )}
      {offers.none && viewer.role === "care_recipient" && <p className="app-hint">{tr.t("event.noActions")}</p>}

      <Message runner={runner} />
    </article>
  );
}
