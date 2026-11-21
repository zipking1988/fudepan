"use client";

import { useActionState } from "react";

import { signIn, type SignInState } from "./actions";

const INITIAL: SignInState = { email: "", fieldErrors: {}, formError: null };

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, INITIAL);
  const { fieldErrors } = state;

  return (
    <form action={action} noValidate className="mt-10 grid gap-7" aria-describedby="sign-in-help">
      <input type="hidden" name="next" value={next} />

      {state.formError && (
        <div role="alert" className="app-alert">
          <p className="app-alert__title">Sign-in didn&apos;t work</p>
          <p>{state.formError}</p>
        </div>
      )}

      <div className="grid gap-2">
        <label htmlFor="email" className="app-label">
          Email address <span className="app-required">(required)</span>
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
          className="app-input"
        />
        {fieldErrors.email && (
          <p id="email-error" className="app-field-error">
            {fieldErrors.email}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <label htmlFor="password" className="app-label">
          Password <span className="app-required">(required)</span>
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-required="true"
          aria-invalid={fieldErrors.password ? true : undefined}
          aria-describedby={fieldErrors.password ? "password-error" : undefined}
          className="app-input"
        />
        {fieldErrors.password && (
          <p id="password-error" className="app-field-error">
            {fieldErrors.password}
          </p>
        )}
      </div>

      <div>
        <button type="submit" className="app-button" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <p role="status" aria-live="polite" className="sr-only">
          {pending ? "Signing in." : ""}
        </p>
      </div>
    </form>
  );
}
