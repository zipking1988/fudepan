"use client";

import Link from "next/link";
import { useActionState, useMemo } from "react";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import { signUp, type SignUpState } from "./actions";

const INITIAL: SignUpState = { email: "", fieldKeys: {}, result: null, messageKey: null };

export function SignUpForm({ language, next }: { language: Language; next: string }) {
  const tr = useMemo(() => createTranslator(language), [language]);
  const [state, action, pending] = useActionState(signUp, INITIAL);
  const { fieldKeys } = state;

  return (
    <form action={action} noValidate className="mt-10 grid gap-7">
      <input type="hidden" name="next" value={next} />

      <div role="status" aria-live="polite">
        {state.result === "check_email" && state.messageKey && (
          <div className="app-success" tabIndex={-1}>
            <p>{tr.t(state.messageKey)}</p>
          </div>
        )}
      </div>
      {state.result === "error" && state.messageKey && (
        <div role="alert" className="app-alert">
          <p>{tr.t(state.messageKey)}</p>
        </div>
      )}

      <div className="grid gap-2">
        <label htmlFor="email" className="app-label">
          {tr.t("signup.email.label")} <span className="app-required">{tr.t("member.required")}</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          aria-required="true"
          aria-invalid={fieldKeys.email ? true : undefined}
          aria-describedby={fieldKeys.email ? "email-error" : undefined}
          defaultValue={state.email}
          key={`email-${state.email}`}
          className="app-input"
        />
        {fieldKeys.email && (
          <p id="email-error" className="app-field-error">
            {tr.t(fieldKeys.email)}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <label htmlFor="password" className="app-label">
          {tr.t("signup.password.label")} <span className="app-required">{tr.t("member.required")}</span>
        </label>
        <p id="password-hint" className="app-hint">
          {tr.t("signup.password.hint")}
        </p>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          aria-required="true"
          aria-invalid={fieldKeys.password ? true : undefined}
          aria-describedby={fieldKeys.password ? "password-hint password-error" : "password-hint"}
          className="app-input"
        />
        {fieldKeys.password && (
          <p id="password-error" className="app-field-error">
            {tr.t(fieldKeys.password)}
          </p>
        )}
      </div>

      <div>
        <button type="submit" className="app-button" disabled={pending}>
          {tr.t("signup.submit")}
        </button>
      </div>

      <p className="app-lede">
        {tr.t("signup.haveAccount")}{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`}>{tr.t("signup.signInLink")}</Link>
      </p>
    </form>
  );
}
