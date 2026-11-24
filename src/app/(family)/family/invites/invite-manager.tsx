"use client";

import { useMemo, useState, useTransition } from "react";
import { HOUSEHOLD_ROLES, type HouseholdRole } from "@/lib/households/membership";
import type { Language } from "@/lib/i18n/format";
import { createTranslator, type MessageKey } from "@/lib/i18n/messages";
import { buildInviteLink } from "@/lib/membership/invite-token";
import type { InviteState } from "@/lib/membership/invite-state";
import { TIME_SLOT, TimedText } from "../local-time";
import { createInviteAction, revokeInviteAction } from "./actions";

export type InviteRow = {
  id: string;
  role: HouseholdRole;
  creatorName: string;
  createdAt: string;
  expiresAt: string;
  state: InviteState;
};

type Panel = { token: string; expiresAt: string } | null;

/** Role picker, one-time link panel, and the invite list. The raw token lives only in `panel`. */
export function InviteManager({
  householdId,
  language,
  initialRole,
  invites,
  listFailed,
}: {
  householdId: string;
  language: Language;
  initialRole: HouseholdRole;
  invites: InviteRow[];
  listFailed: boolean;
}) {
  const tr = useMemo(() => createTranslator(language), [language]);
  const [role, setRole] = useState<HouseholdRole>(initialRole);
  const [panel, setPanel] = useState<Panel>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [status, setStatus] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const link = panel && typeof window !== "undefined" ? buildInviteLink(window.location.origin, panel.token) : "";
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  function make() {
    if (pending) return;
    setError(null);
    setStatus("");
    setCopied(false);
    startTransition(async () => {
      const result = await createInviteAction({ householdId, role });
      if (!result.ok) {
        setPanel(null);
        setError(result.messageKey);
        return;
      }
      setPanel({ token: result.token, expiresAt: result.expiresAt });
      setStatus(tr.t("invites.created"));
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function revoke(inviteId: string) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await revokeInviteAction({ householdId, inviteId });
      setConfirming(null);
      if (!result.ok) {
        setError(result.messageKey);
        return;
      }
      setStatus(
        result.state === "revoked"
          ? tr.t("invites.revoke.done")
          : tr.t("invites.revoke.notPending", { state: tr.t(`inviteState.${result.inviteState}` as MessageKey) }),
      );
    });
  }

  return (
    <div className="grid gap-8">
      <section aria-labelledby="invites-heading" className="grid gap-5">
        <div>
          <h1 id="invites-heading" className="app-title">
            {tr.t("invites.title")}
          </h1>
          <p className="app-lede">{tr.t("invites.lede")}</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            make();
          }}
          aria-busy={pending}
          className="grid gap-4"
        >
          <fieldset className="grid gap-3 border-0 p-0">
            <legend className="app-label mb-2">{tr.t("invites.role.label")}</legend>
            {HOUSEHOLD_ROLES.map((r) => (
              <label
                key={r}
                htmlFor={`invite-role-${r}`}
                className="flex min-h-12 cursor-pointer items-start gap-3 rounded border-2 border-current px-4 py-3"
              >
                <input
                  id={`invite-role-${r}`}
                  type="radio"
                  name="role"
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="mt-1 size-6 shrink-0"
                />
                <span>
                  <span className="app-label block">{tr.t(`role.${r}.label` as MessageKey)}</span>
                  <span className="app-hint block">{tr.t(`role.${r}.description` as MessageKey)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <button type="submit" className="app-button" disabled={pending}>
              {pending ? tr.t("invites.working") : tr.t("invites.create")}
            </button>
          </div>
        </form>
        <div role="status" aria-live="polite">
          {status && <p className="app-success font-semibold">{status}</p>}
        </div>
        {error && (
          <div role="alert" className="app-alert">
            <p>{tr.t(error)}</p>
          </div>
        )}
        {panel && (
          <section aria-labelledby="invite-panel-heading" className="app-panel grid gap-3">
            <h2 id="invite-panel-heading" className="app-subtitle">
              {tr.t("invites.panel.title")}
            </h2>
            <label htmlFor="invite-link" className="app-label">
              {tr.t("invites.panel.linkLabel")}
            </label>
            <input id="invite-link" className="app-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex flex-wrap gap-3">
              <button type="button" className="app-button" onClick={copy}>
                {tr.t("invites.panel.copy")}
              </button>
              {canShare && (
                <button
                  type="button"
                  className="app-button app-button--quiet"
                  onClick={() => {
                    navigator.share({ url: link, title: tr.t("invites.panel.title") }).catch(() => {});
                  }}
                >
                  {tr.t("invites.panel.share")}
                </button>
              )}
              <button
                type="button"
                className="app-button app-button--quiet"
                onClick={() => {
                  setPanel(null);
                  setCopied(false);
                }}
              >
                {tr.t("invites.panel.close")}
              </button>
            </div>
            <div role="status" aria-live="polite">
              {copied && <p className="app-success font-semibold">{tr.t("invites.panel.copied")}</p>}
            </div>
            <p className="app-hint">{tr.t("invites.panel.notSent")}</p>
            <p className="app-hint">{tr.t("invites.panel.once")}</p>
            <p className="app-hint">
              <TimedText sentence={tr.t("invites.panel.expires", { time: TIME_SLOT })} iso={panel.expiresAt} language={language} />
            </p>
            <p className="app-hint">{tr.t("invites.panel.gone")}</p>
            {role === "care_recipient" && <p className="app-hint">{tr.t("invites.recipientHint")}</p>}
          </section>
        )}
      </section>
      <section aria-labelledby="invite-list-heading" className="grid gap-4">
        <h2 id="invite-list-heading" className="app-subtitle">
          {tr.t("invites.list.title")}
        </h2>
        {listFailed && (
          <div role="alert" className="app-alert">
            <p>{tr.t("membership.error.generic")}</p>
          </div>
        )}
        {!listFailed && invites.length === 0 && <p className="app-hint">{tr.t("invites.list.empty")}</p>}
        <ul className="grid gap-3 p-0" style={{ listStyle: "none" }}>
          {invites.map((invite) => {
            const roleLabel = tr.t(`role.${invite.role}.label` as MessageKey);
            return (
              <li key={invite.id} className="app-panel grid gap-1">
                <p className="app-label">{tr.t("invites.list.role", { role: roleLabel })}</p>
                <p>{tr.t("invites.list.state", { state: tr.t(`inviteState.${invite.state}` as MessageKey) })}</p>
                {invite.creatorName && <p className="app-hint">{tr.t("invites.list.creator", { name: invite.creatorName })}</p>}
                <p className="app-hint">
                  <TimedText sentence={tr.t("invites.list.created", { time: TIME_SLOT })} iso={invite.createdAt} language={language} />
                </p>
                <p className="app-hint">
                  <TimedText sentence={tr.t("invites.list.expires", { time: TIME_SLOT })} iso={invite.expiresAt} language={language} />
                </p>
                {invite.state === "pending" &&
                  (confirming === invite.id ? (
                    <div className="grid gap-3" role="group" aria-label={tr.t("invites.revoke")}>
                      <p>{tr.t("invites.revoke.confirm", { role: roleLabel })}</p>
                      <div className="flex flex-wrap gap-3">
                        <button type="button" className="app-button" disabled={pending} onClick={() => revoke(invite.id)}>
                          {tr.t("invites.revoke.yes")}
                        </button>
                        <button type="button" className="app-button app-button--quiet" onClick={() => setConfirming(null)}>
                          {tr.t("invites.revoke.no")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button type="button" className="app-button app-button--quiet" onClick={() => setConfirming(invite.id)}>
                        {tr.t("invites.revoke")}
                      </button>
                    </div>
                  ))}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
