"use client";
import { useActionState, useState } from "react";
import { RiskMedium } from "@/components/landing/icons";
import { signIn, type SignInState } from "./actions";
const INITIAL: SignInState = { email: "", fieldErrors: {}, formError: null };
export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, INITIAL);
  const { fieldErrors } = state;
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form action={action} noValidate className="lp-auth__form" aria-describedby="sign-in-help">
      <input type="hidden" name="next" value={next} />
      {state.formError && (
        <div role="alert" className="lp-auth__alert">
          <p className="lp-auth__alertTitle">
            <RiskMedium />
            Sign-in didn&apos;t work
          </p>
          <p>{state.formError}</p>
        </div>
      )}
      <div className="lp-auth__field">
        <label htmlFor="email" className="lp-auth__label">
          Email address <span className="lp-auth__required">(required)</span>
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          aria-required="true"
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          defaultValue={state.email}
          key={`email-${state.email}`}
          className="lp-auth__input"
        />
        {fieldErrors.email && (
          <p id="email-error" className="lp-auth__error">
            <RiskMedium />
            {fieldErrors.email}
          </p>
        )}
      </div>
      <div className="lp-auth__field">
        <label htmlFor="password" className="lp-auth__label">
          Password <span className="lp-auth__required">(required)</span>
        </label>
        <div className="lp-auth__password">
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-required="true"
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            className="lp-auth__input"
          />
          <button
            type="button"
            className="lp-auth__reveal"
            aria-controls="password"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((shown) => !shown)}
          >
            {showPassword ? "Hide" : "Show"}
            <span className="lp-sr"> password</span>
          </button>
        </div>
        {fieldErrors.password && (
          <p id="password-error" className="lp-auth__error">
            <RiskMedium />
            {fieldErrors.password}
          </p>
        )}
      </div>
      <div>
        <button
          type="submit"
          className="lp-btn lp-btn--navy lp-btn--large lp-auth__submit"
          disabled={pending}
        >
          {pending && <span className="lp-auth__spinner" aria-hidden="true" />}
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p role="status" aria-live="polite" className="lp-sr">
          {pending ? "Signing in." : ""}
        </p>
      </div>
    </form>
  );
}
