import "../app.css";

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { safeNextPath } from "@/lib/auth/next-path";

import { SIGN_IN_HELP } from "./help";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in — Fudepan",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/" className="app-wordmark">
          Fudepan
        </Link>
      </header>
      <main id="main" className="app-main app-main--narrow">
        <h1 className="app-title">Sign in</h1>
        <p id="sign-in-help" className="app-lede">
          Sign in to see your household&apos;s notes. If you don&apos;t have an account or forgot
          your password, see the help below the form.
        </p>
        {/* The static shell already holds a working form; the boundary only adds `?next=`. */}
        <Suspense fallback={<LoginForm next="/notes" />}>
          <LoginFormWithNext searchParams={searchParams} />
        </Suspense>

        <section className="app-help" aria-labelledby="sign-in-help-title">
          <h2 id="sign-in-help-title" className="app-help__heading">
            {SIGN_IN_HELP.title}
          </h2>
          {[SIGN_IN_HELP.noAccount, SIGN_IN_HELP.forgotPassword].map((topic) => (
            <div key={topic.title} className="app-help__topic">
              <h3 className="app-help__title">{topic.title}</h3>
              <ul className="app-help__steps">
                {topic.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}

async function LoginFormWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <LoginForm next={safeNextPath(next)} />;
}
