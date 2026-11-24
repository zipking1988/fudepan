import "@/components/landing/landing.css";
import "./login.css";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type CSSProperties } from "react";
import { COPY, EXAMPLE_COPY, IMAGE_SIZE, IMAGES, LINKS } from "@/components/landing/content";
import type { PersonId } from "@/components/landing/example";
import { BrushTicks, Camera, Heart, Shield } from "@/components/landing/icons";
import { landingFontClasses } from "@/components/landing/landing-fonts";
import { Wordmark } from "@/components/landing/landing";
import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from "@/lib/auth/next-path";
import { getDemoAccount } from "./demo-account";
import { DemoSignIn } from "./demo-sign-in";
import { SIGN_IN_HELP } from "./help";
import { LoginForm } from "./login-form";
export const metadata: Metadata = {
  title: "Sign in — Fudepan",
};
/** The page is in English, so its links go to the English landing at /en. */
const HOME = LINKS.home.en;
/**
 * Sign-in, dressed like the landing: the same header and wordmark, cream page,
 * a paper card for the form, then a wave into a lavender band with the help.
 * When a demo account is configured, a demo box comes first so visitors can
 * look around with one click. There is no sign-up link here.
 */
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className={`lp lp-auth ${landingFontClasses}`} lang="en">
      <a href="#main" className="lp-skip">
        Skip to main content
      </a>
      <header className="lp-header">
        <div className="lp-shell lp-header__bar">
          <Wordmark lang="en" />
          <nav aria-label="Site">
            <ul className="lp-nav">
              <li>
                <Link href={HOME}>Back to the home page</Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="lp-auth__top" aria-labelledby="sign-in-title">
          <div className="lp-shell lp-auth__grid">
            <div className="lp-auth__head lp-auth__rise" style={{ "--d": "0ms" } as CSSProperties}>
              <h1 id="sign-in-title" className="lp-auth__title">
                <span className="lp-mark lp-mark--violet lp-auth__mark">Sign in</span>
              </h1>
              <p id="sign-in-help" className="lp-auth__lede">
                Sign in to see your household&apos;s notes. If you forgot your password, see the
                help below the form.
              </p>
            </div>
            <div
              className="lp-auth__card lp-auth__rise"
              style={{ "--d": "120ms" } as CSSProperties}
            >
              {/* The static shell already holds working forms; the boundary only adds `?next=`. */}
              <Suspense fallback={<SignInForms next={DEFAULT_SIGNED_IN_PATH} />}>
                <SignInFormsWithNext searchParams={searchParams} />
              </Suspense>
            </div>
            <AuthArt />
          </div>
          <svg
            className="lp-wave"
            viewBox="0 0 1440 80"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M0 46C180 12 380 6 620 30s520 46 820 2V80H0Z" />
          </svg>
        </section>
        <section className="lp-auth__help" aria-labelledby="sign-in-help-title">
          <div className="lp-shell">
            <h2 id="sign-in-help-title" className="lp-auth__helpTitle">
              {SIGN_IN_HELP.title}
            </h2>
            <div className="lp-auth__topics">
              {helpTopics().map((topic) => (
                <div key={topic.title} className="lp-auth__topic">
                  <h3 className="lp-auth__topicTitle">{topic.title}</h3>
                  <ul className="lp-auth__steps">
                    {topic.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="lp-footer">
        <div className="lp-shell lp-footer__inner">
          <Wordmark lang="en" />
          <nav aria-label="Footer">
            <ul className="lp-footer__links">
              <li>
                <Link href={`${HOME}${LINKS.how}`}>How it works</Link>
              </li>
              <li>
                <Link href={LINKS.demo.en}>Demo</Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
const FAMILY: PersonId[] = ["misa", "kenta", "yui"];
/** What a visitor can try in the demo household (supabase/seed.sql), one short line each. */
const DEMO_HIGHLIGHTS = [
  { Icon: Camera, text: "Open Grandma's clinic visit and errands, read from her note" },
  { Icon: Heart, text: "Take on a part that still needs someone" },
  { Icon: Shield, text: "Confirm the parts that are waiting for confirmation" },
] as const;
/**
 * Grandma's photo, her note, and the family from the landing hero, with a short
 * list of what the demo shows. Each piece arrives once, a little after the last.
 */
function AuthArt() {
  const { hero } = COPY.en;
  const people = EXAMPLE_COPY.en.people;
  return (
    <div className="lp-auth__art">
      <div className="lp-auth__scene">
        <div className="lp-auth__photo lp-auth__rise" style={{ "--d": "200ms" } as CSSProperties}>
          <Image
            src={IMAGES.hero}
            alt={hero.photoAlt}
            {...IMAGE_SIZE.grandma}
            priority
            sizes="(min-width: 860px) 30rem, 92vw"
          />
          <BrushTicks className="lp-auth__ticks" />
        </div>
        <div className="lp-auth__note">
          <Image
            src={IMAGES.note}
            alt={hero.noteAlt}
            {...IMAGE_SIZE.note}
            sizes="(min-width: 860px) 15rem, 50vw"
          />
        </div>
        <ul className="lp-auth__family" aria-label={hero.familyLabel}>
          {FAMILY.map((id, i) => (
            <li
              key={id}
              className={`lp-auth__person lp-auth__person--${id}`}
              style={{ "--d": `${700 + i * 110}ms` } as CSSProperties}
            >
              <Image src={IMAGES.people[id]} alt="" {...IMAGE_SIZE.person} sizes="6rem" />
              <span>{people[id]}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="lp-auth__try lp-auth__rise" style={{ "--d": "1000ms" } as CSSProperties}>
        <h2 className="lp-auth__tryTitle">In the demo, you can</h2>
        <ul className="lp-auth__tryList">
          {DEMO_HIGHLIGHTS.map(({ Icon, text }) => (
            <li key={text}>
              <span className="lp-auth__tryIcon">
                <Icon />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
/** The help topics; "No account yet" points to the demo only when the demo box is shown. */
function helpTopics(): { title: string; steps: readonly string[] }[] {
  const { noAccount, forgotPassword, demoStep } = SIGN_IN_HELP;
  const steps = getDemoAccount() ? [...noAccount.steps, demoStep] : noAccount.steps;
  return [{ title: noAccount.title, steps }, forgotPassword];
}
async function SignInFormsWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams;
  return <SignInForms next={safeNextPath(next)} />;
}
function SignInForms({ next }: { next: string }) {
  const demo = getDemoAccount();
  if (!demo) return <LoginForm next={next} />;
  return (
    <>
      <DemoSignIn email={demo.email} password={demo.password} next={next} />
      <h2 className="lp-auth__or">
        <span>Or sign in with your own account</span>
      </h2>
      <LoginForm next={next} />
    </>
  );
}
