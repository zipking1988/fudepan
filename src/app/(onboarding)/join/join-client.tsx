"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { tokenFromFragment } from "@/lib/membership/invite-fragment";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import { acceptInvite, openInvite, type AcceptInviteState, type OpenInviteResult } from "./actions";

const INITIAL: AcceptInviteState = { values: { displayName: "" }, fieldKeys: {}, errorKey: null, unusable: false };

/**
 * Reads the token from the address fragment (browsers never send it to servers), removes it from
 * the address bar, and asks the server about it. With no fragment it falls back to the cookie.
 */
export function JoinClient({
  language,
  signedIn,
  hasCookie,
}: {
  language: Language;
  signedIn: boolean;
  hasCookie: boolean;
}) {
  const tr = useMemo(() => createTranslator(language), [language]);
  const [opened, setOpened] = useState<OpenInviteResult | null>(null);
  const [state, action, pending] = useActionState(acceptInvite, INITIAL);

  useEffect(() => {
    const token = tokenFromFragment(window.location.hash);
    if (window.location.hash) window.history.replaceState(null, "", "/join");
    let cancelled = false;
    // With no token and no cookie the server answers "none" without a lookup.
    (token || hasCookie ? openInvite({ token }) : Promise.resolve<OpenInviteResult>({ kind: "none" })).then(
      (result) => {
        if (!cancelled) setOpened(result);
      },
      () => {
        if (!cancelled) setOpened({ kind: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [hasCookie]);

  if (opened === null) return <p role="status">{tr.t("join.loading")}</p>;
  if (opened.kind === "none") return <p className="app-lede">{tr.t("join.noLink")}</p>;
  if (opened.kind === "error") {
    return (
      <div role="alert" className="app-alert">
        <p>{tr.t("membership.error.generic")}</p>
      </div>
    );
  }
  if (opened.kind === "unusable" || state.unusable) {
    return (
      <div role="alert" className="app-alert">
        <p>{tr.t("join.unusable")}</p>
      </div>
    );
  }

  const role = tr.t(`role.${opened.role}.label`);
  const expires = new Intl.DateTimeFormat(language, {
    // dateStyle/timeStyle cannot be combined with timeZoneName, so name each field.
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(opened.expiresAt));
  const preview = opened.creatorName
    ? tr.t("join.preview", { creator: opened.creatorName, household: opened.householdName, role })
    : tr.t("join.previewNoCreator", { household: opened.householdName, role });

  return (
    <div data-size={opened.role === "care_recipient" ? "large" : undefined} className="grid gap-7">
      <p className="app-lede">{preview}</p>
      <p className="app-hint">{tr.t("join.expires", { time: expires })}</p>

      {!signedIn ? (
        <div className="grid gap-4">
          <p>{tr.t("join.signInFirst")}</p>
          <div className="flex flex-wrap gap-4">
            <Link href="/signup?next=%2Fjoin" className="app-button">
              {tr.t("join.createAccount")}
            </Link>
            <Link href="/login?next=%2Fjoin" className="app-button app-button--quiet">
              {tr.t("join.signIn")}
            </Link>
          </div>
        </div>
      ) : (
        <form action={action} noValidate className="grid gap-7">
          {state.errorKey && (
            <div role="alert" className="app-alert">
              <p>{tr.t(state.errorKey)}</p>
            </div>
          )}
          <div className="grid gap-2">
            <label htmlFor="displayName" className="app-label">
              {tr.t("join.displayName.label")} <span className="app-required">{tr.t("member.required")}</span>
            </label>
            <p id="displayName-hint" className="app-hint">
              {tr.t("join.displayName.hint")}
            </p>
            <input
              id="displayName"
              name="displayName"
              type="text"
              autoComplete="name"
              required
              aria-required="true"
              maxLength={80}
              aria-invalid={state.fieldKeys.displayName ? true : undefined}
              aria-describedby={state.fieldKeys.displayName ? "displayName-hint displayName-error" : "displayName-hint"}
              defaultValue={state.values.displayName}
              key={`displayName-${state.values.displayName}`}
              className="app-input"
            />
            {state.fieldKeys.displayName && (
              <p id="displayName-error" className="app-field-error">
                {tr.t(state.fieldKeys.displayName)}
              </p>
            )}
          </div>
          <div>
            <button type="submit" className="app-button" disabled={pending}>
              {tr.t("join.accept")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
