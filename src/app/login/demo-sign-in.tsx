"use client";
import { useActionState } from "react";
import { RiskMedium, Sparkle } from "@/components/landing/icons";
import { signInAsDemo, type SignInState } from "./actions";
const INITIAL: SignInState = { email: "", fieldErrors: {}, formError: null };
/**
 * The demo box on /login: one button that signs in to the fictional demo
 * household, plus the email and password written out for anyone who would
 * rather type them. The button never sends the password from the browser.
 */
export function DemoSignIn({
  email,
  password,
  next,
}: {
  email: string;
  password: string;
  next: string;
}) {
  const [state, action, pending] = useActionState(signInAsDemo, INITIAL);
  return (
    <section className="lp-auth__demo" aria-labelledby="demo-title">
      <h2 id="demo-title" className="lp-auth__demoTitle">
        <Sparkle />
        Just looking around?
      </h2>
      <p>
        Sign in to a demo family with made-up people and notes. Anyone can use it, so don&apos;t
        enter real names or details.
      </p>
      <form action={action}>
        <input type="hidden" name="next" value={next} />
        {state.formError && (
          <div role="alert" className="lp-auth__alert lp-auth__demoAlert">
            <p className="lp-auth__alertTitle">
              <RiskMedium />
              The demo didn&apos;t open
            </p>
            <p>{state.formError}</p>
          </div>
        )}
        <button
          type="submit"
          className="lp-btn lp-btn--ember lp-btn--large lp-auth__submit lp-auth__demoBtn"
          disabled={pending}
        >
          {pending && <span className="lp-auth__spinner" aria-hidden="true" />}
          {pending ? "Opening the demo…" : "Sign in to the demo"}
        </button>
        <p role="status" aria-live="polite" className="lp-sr">
          {pending ? "Opening the demo." : ""}
        </p>
      </form>
      <dl className="lp-auth__demoCreds">
        <div>
          <dt>Email address</dt>
          <dd>{email}</dd>
        </div>
        <div>
          <dt>Password</dt>
          <dd>{password}</dd>
        </div>
      </dl>
    </section>
  );
}
