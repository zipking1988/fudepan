"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { HOUSEHOLD_ROLES, type HouseholdRole } from "@/lib/households/membership";
import type { Language } from "@/lib/i18n/format";
import { createTranslator, isMessageKey, type MessageKey, type Translator } from "@/lib/i18n/messages";
import type { HeldPart } from "@/lib/membership/held-parts";
import type { MemberRowAction } from "@/lib/membership/member-actions";
import { LocalTime } from "../local-time";
import { Avatar, Icon, Tape } from "../playful/ui";
import { PortraitButton } from "./portrait-button";
import { changeRoleAction, leaveAction, loadHeldPartsAction, removeMemberAction, renameAction } from "./actions";

export type MemberRow = {
  id: string;
  name: string;
  role: HouseholdRole;
  isYou: boolean;
  actions: MemberRowAction[];
  /** Private same-household route of the portrait, or null for initials. */
  portraitSrc?: string | null;
  /** The viewer may add or change this care recipient's photo. */
  canSetPortrait?: boolean;
};
export type HistoryRow = { id: string; eventType: string; createdAt: string };

type Step =
  | { kind: "role"; memberId: string; role: HouseholdRole; confirmDemote: boolean }
  | { kind: "remove" | "leave"; memberId: string; parts: HeldPart[] | null }
  | { kind: "rename"; memberId: string; value: string; error: MessageKey | null };

function HeldList({ tr, name, parts }: { tr: Translator; name: string; parts: HeldPart[] }) {
  if (parts.length === 0) return <p className="app-hint">{tr.t("members.held.none", { name })}</p>;
  return (
    <div>
      <p className="app-label">{tr.t("members.held.title", { name })}</p>
      <ul className="mt-2 grid gap-2 pl-5">
        {parts.flatMap((p) => {
          const lines: string[] = [];
          if (p.ownerless) lines.push(tr.t("members.held.owner", { title: p.title, name }));
          if (p.roles.some((r) => r !== "owner")) lines.push(tr.t("members.held.helper", { title: p.title, name }));
          if (p.pendingRequestIds.length > 0) lines.push(tr.t("members.held.requests", { title: p.title, name }));
          if (p.approvalWillReset) lines.push(tr.t("members.held.approvalReset", { title: p.title, name }));
          return lines.map((line, i) => <li key={`${p.partId}-${i}`}>{line}</li>);
        })}
      </ul>
    </div>
  );
}

export function MembersManager({
  householdId,
  language,
  isPrimary,
  members,
  history,
  inviteCount = null,
}: {
  householdId: string;
  language: Language;
  isPrimary: boolean;
  members: MemberRow[];
  history: HistoryRow[];
  /** Active invite links, for primary caregivers only. Null when unknown. */
  inviteCount?: number | null;
}) {
  const tr = useMemo(() => createTranslator(language), [language]);
  const [step, setStep] = useState<Step | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<MessageKey | null>(null);
  const [pending, startTransition] = useTransition();
  const [managing, setManaging] = useState<string | null>(null);
  // A saved portrait shows at once; the refreshed server data later carries the same version.
  const [fresh, setFresh] = useState<Record<string, string>>({});

  function fail(key: MessageKey) {
    setError(key);
    setStatus("");
  }

  function begin(next: Step) {
    setError(null);
    setStatus("");
    setStep(next);
    if (next.kind === "remove" || next.kind === "leave") {
      startTransition(async () => {
        const result = await loadHeldPartsAction({ householdId, memberId: next.memberId });
        if (!result.ok) {
          setStep(null);
          fail(result.messageKey);
          return;
        }
        setStep({ ...next, parts: result.parts });
      });
    }
  }

  function run(task: () => Promise<{ ok: boolean; messageKey?: MessageKey } | undefined>, done: string) {
    if (pending) return;
    startTransition(async () => {
      const result = await task();
      // A successful leave redirects, so no result comes back.
      if (!result) return;
      if (!result.ok) {
        // Departure and role failures change nothing; say so.
        fail(result.messageKey ?? "membership.error.generic");
        return;
      }
      setError(null);
      setStep(null);
      setStatus(done);
    });
  }

  function saveRole(memberId: string, role: HouseholdRole) {
    run(async () => {
      const r = await changeRoleAction({ householdId, memberId, role });
      return r.ok ? { ok: true } : { ok: false, messageKey: r.messageKey };
    }, tr.t("members.changeRole.done"));
  }

  const TAPES = ["butter", "mint", "apricot"] as const;
  return (
    <div className="pb-members">
      <section aria-labelledby="members-heading" className="pb-members__main">
        <div className="pb-members__head">
          <h1 id="members-heading" className="pb-title">
            <span className="pb-title__mark">{tr.t("pb.members.title")}</span>
          </h1>
          {isPrimary && (
            <Link href="/family/invites" className="pb-btn pb-btn--ember">
              <Icon name="userPlus" size={24} /> {tr.t("pb.members.invite")}
            </Link>
          )}
        </div>
        <div role="status" aria-live="polite">
          {status && <p className="pb-live__ok">{status}</p>}
        </div>
        {error && (
          <div role="alert" className="pb-capture__error">
            <p>{tr.t(error)}</p>
            <p>{tr.t("members.nothingChanged")}</p>
          </div>
        )}
        {members.length === 0 && <p className="pb-hint">{tr.t("members.empty")}</p>}
        <ul className="pb-album">
          {members.map((m, index) => {
            const mine = step && step.memberId === m.id ? step : null;
            const canManage = m.actions.length > 0;
            const open = managing === m.id || mine !== null;
            return (
              <li key={m.id} className={`pb-member ${m.isYou ? "pb-member--you" : ""}`} data-member-card>
                <div className="pb-member__photo">
                  <Tape tone={TAPES[index % TAPES.length]} className="pb-member__tape" />
                  <Avatar
                    name={m.name}
                    householdId={householdId}
                    memberId={m.id}
                    src={fresh[m.id] ? `/family/members/${m.id}/portrait?v=${encodeURIComponent(fresh[m.id])}` : (m.portraitSrc ?? null)}
                    size={150}
                    className="pb-avatar--square"
                  />
                </div>
                <div className="pb-member__text">
                  <p className="pb-member__name">
                    {m.isYou ? tr.t("pb.youName", { name: m.name }) : m.name}
                  </p>
                  <p className="pb-member__role">
                    <span className="sr-only">{tr.t("members.role", { role: "" })}</span>
                    {tr.t(`role.${m.role}.label` as MessageKey)}
                  </p>
                  {m.canSetPortrait && (
                    <PortraitButton memberId={m.id} name={m.name} hasPhoto={Boolean(m.portraitSrc || fresh[m.id])}
                      language={language}
                      onSaved={(version) => setFresh((f) => ({ ...f, [m.id]: version }))}
                    />
                  )}
                  {canManage && (
                    <button
                      type="button"
                      className="pb-member__manage"
                      aria-expanded={open}
                      aria-controls={`manage-${m.id}`}
                      onClick={() => setManaging(managing === m.id ? null : m.id)}
                    >
                      {tr.t("pb.members.manage")} <Icon name="chevronRight" size={18} />
                      <span className="sr-only"> {m.name}</span>
                    </button>
                  )}
                </div>
                <div id={`manage-${m.id}`} className="pb-member__panel" hidden={!open}>
                {!mine && (
                  <div className="flex flex-wrap gap-3">
                    {m.actions.includes("change_role") && (
                      <button
                        type="button"
                        className="app-button app-button--quiet"
                        onClick={() => begin({ kind: "role", memberId: m.id, role: m.role, confirmDemote: false })}
                      >
                        {tr.t("members.changeRole")}
                      </button>
                    )}
                    {m.actions.includes("remove") && (
                      <button
                        type="button"
                        className="app-button app-button--quiet"
                        onClick={() => begin({ kind: "remove", memberId: m.id, parts: null })}
                      >
                        {tr.t("members.remove")}
                      </button>
                    )}
                    {m.actions.includes("edit_name") && (
                      <button
                        type="button"
                        className="app-button app-button--quiet"
                        onClick={() => begin({ kind: "rename", memberId: m.id, value: m.name, error: null })}
                      >
                        {tr.t("members.editName")}
                      </button>
                    )}
                    {m.actions.includes("leave") && (
                      <button
                        type="button"
                        className="app-button app-button--quiet"
                        onClick={() => begin({ kind: "leave", memberId: m.id, parts: null })}
                      >
                        {tr.t("members.leave")}
                      </button>
                    )}
                  </div>
                )}
                {mine?.kind === "role" && !mine.confirmDemote && (
                  <form
                    className="grid gap-3"
                    aria-busy={pending}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (m.role === "primary_caregiver" && mine.role !== "primary_caregiver") {
                        setStep({ ...mine, confirmDemote: true });
                      } else saveRole(m.id, mine.role);
                    }}
                  >
                    <label htmlFor={`role-${m.id}`} className="app-label">
                      {tr.t("members.changeRole.label", { name: m.name })}
                    </label>
                    <select
                      id={`role-${m.id}`}
                      className="app-input"
                      value={mine.role}
                      onChange={(e) => setStep({ ...mine, role: e.target.value as HouseholdRole })}
                    >
                      {HOUSEHOLD_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {tr.t(`role.${r}.label` as MessageKey)}
                        </option>
                      ))}
                    </select>
                    <p className="app-hint">{tr.t(`role.${mine.role}.description` as MessageKey)}</p>
                    <div className="flex flex-wrap gap-3">
                      <button type="submit" className="app-button" disabled={pending}>
                        {pending ? tr.t("members.working") : tr.t("members.changeRole.save")}
                      </button>
                      <button type="button" className="app-button app-button--quiet" onClick={() => setStep(null)}>
                        {tr.t("members.changeRole.cancel")}
                      </button>
                    </div>
                  </form>
                )}
                {mine?.kind === "role" && mine.confirmDemote && (
                  <div className="grid gap-3" role="group" aria-label={tr.t("members.changeRole")}>
                    <p>{tr.t("members.demote.confirm", { name: m.name })}</p>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" className="app-button" disabled={pending} onClick={() => saveRole(m.id, mine.role)}>
                        {tr.t("members.demote.yes")}
                      </button>
                      <button type="button" className="app-button app-button--quiet" onClick={() => setStep(null)}>
                        {tr.t("members.demote.no")}
                      </button>
                    </div>
                  </div>
                )}
                {(mine?.kind === "remove" || mine?.kind === "leave") && (
                  <div className="grid gap-3" role="group" aria-label={tr.t(mine.kind === "remove" ? "members.remove" : "members.leave")}>
                    <p>
                      {mine.kind === "remove"
                        ? tr.t("members.remove.confirm", { name: m.name })
                        : tr.t("members.leave.confirm")}
                    </p>
                    {mine.parts === null ? (
                      <p role="status">{tr.t("members.working")}</p>
                    ) : (
                      <HeldList tr={tr} name={m.name} parts={mine.parts} />
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className="app-button"
                        disabled={pending || mine.parts === null}
                        onClick={() =>
                          mine.kind === "remove"
                            ? run(async () => {
                                const r = await removeMemberAction({ householdId, memberId: m.id });
                                return r.ok ? { ok: true } : { ok: false, messageKey: r.messageKey };
                              }, tr.t("members.remove.done", { name: m.name }))
                            : run(async () => {
                                const r = await leaveAction({ householdId });
                                return r.ok ? { ok: true } : { ok: false, messageKey: r.messageKey };
                              }, "")
                        }
                      >
                        {mine.kind === "remove" ? tr.t("members.remove.yes", { name: m.name }) : tr.t("members.leave.yes")}
                      </button>
                      <button type="button" className="app-button app-button--quiet" onClick={() => setStep(null)}>
                        {mine.kind === "remove" ? tr.t("members.remove.no", { name: m.name }) : tr.t("members.leave.no")}
                      </button>
                    </div>
                  </div>
                )}
                {mine?.kind === "rename" && (
                  <form
                    className="grid gap-3"
                    aria-busy={pending}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (pending) return;
                      const value = mine.value;
                      startTransition(async () => {
                        const r = await renameAction({ householdId, displayName: value });
                        if (r.ok) {
                          setStep(null);
                          setStatus(tr.t("members.editName.done"));
                        } else if (r.fieldKeys?.displayName !== undefined || r.messageKey === "members.editName.error") {
                          // Keep what was typed so it can be corrected.
                          setStep({ ...mine, value, error: "members.editName.error" });
                        } else {
                          fail(r.messageKey);
                        }
                      });
                    }}
                  >
                    <label htmlFor={`name-${m.id}`} className="app-label">
                      {tr.t("members.editName.label")} <span className="app-required">{tr.t("member.required")}</span>
                    </label>
                    <input
                      id={`name-${m.id}`}
                      className="app-input"
                      required
                      value={mine.value}
                      aria-invalid={mine.error ? true : undefined}
                      aria-describedby={mine.error ? `name-error-${m.id}` : undefined}
                      onChange={(e) => setStep({ ...mine, value: e.target.value, error: null })}
                    />
                    {mine.error && (
                      <p id={`name-error-${m.id}`} role="alert" className="app-field-error">
                        {tr.t(mine.error)}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3">
                      <button type="submit" className="app-button" disabled={pending}>
                        {pending ? tr.t("members.working") : tr.t("members.editName.save")}
                      </button>
                      <button type="button" className="app-button app-button--quiet" onClick={() => setStep(null)}>
                        {tr.t("members.changeRole.cancel")}
                      </button>
                    </div>
                  </form>
                )}
                </div>
              </li>
            );
          })}
        </ul>
        {isPrimary && (
          <section className="pb-invites" aria-labelledby="invites-heading">
            <h2 id="invites-heading">{tr.t("pb.members.invites")}</h2>
            <p>
              {inviteCount === null || inviteCount === 0
                ? tr.t("pb.members.invites.none")
                : tr.tCount("pb.members.invites.some", inviteCount)}
            </p>
            <Link href="/family/invites" className="pb-link">
              {tr.t("pb.members.invites.open")}
            </Link>
          </section>
        )}
      </section>
      {isPrimary && (
        <section aria-labelledby="history-heading" className="pb-history">
          <h2 id="history-heading" className="pb-ribbon pb-ribbon--butter">
            {tr.t("members.history.title")}
          </h2>
          {history.length === 0 ? (
            <p className="app-hint">{tr.t("members.history.empty")}</p>
          ) : (
            <ul>
              {history.map((e) => {
                const key = `audit.membership.${e.eventType}`;
                return (
                  <li key={e.id}>
                    <p>{isMessageKey(key) ? tr.t(key) : tr.t("membership.error.generic")}</p>
                    <p className="app-hint">
                      <LocalTime iso={e.createdAt} language={language} />
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
