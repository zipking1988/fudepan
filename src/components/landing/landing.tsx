import "./landing.css";

import type { CSSProperties } from "react";

import {
  AUDIENCE,
  FINAL_CTA,
  FOLLOW_UP,
  type FollowUpEvent,
  FOOTER,
  gap,
  HERO,
  isOnTime,
  KIRO,
  NAV,
  SAFETY,
  SIGN_IN_HREF,
} from "./content";
import { AccentText } from "./accent-title";
import { DraftDemo } from "./draft-demo";
import { HowItWorks } from "./how-it-works";
import { InPageLinks } from "./in-page-links";
import { LandingMotion } from "./motion/landing-motion";
import { Arrow, Check, Cross, RiskLabel } from "./primitives";
import { Reveal } from "./reveal";

/**
 * The landing page says what Fudepan is in the first screen, shows it working
 * on a real-looking note, then answers the questions a family will ask:
 * how it works, what happens if nobody responds, and what the AI may not do.
 */
export function Landing() {
  return (
    <div className="landing" data-landing>
      <span aria-hidden="true" className="backdrop" />
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1}>
        <Hero />
        <HowItWorks />
        <FollowUp />
        <Safety />
        <Audience />
        <FinalCta />
      </main>
      <SiteFooter />
      <Reveal />
      <InPageLinks />
      <LandingMotion />
    </div>
  );
}

function Wordmark() {
  return (
    <a href="#top" className="wordmark" aria-label="Fudepan, back to top">
      <span aria-hidden="true" className="wordmark__note" />
      Fudepan
    </a>
  );
}

function SiteHeader() {
  return (
    <header className="site-header" data-site-header>
      <div className="site-header__bar">
        <Wordmark />
        <nav aria-label="Page sections" className="site-nav">
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <a href={SIGN_IN_HREF} className="button button--small button--ghost" data-magnetic>
          Sign in
        </a>
      </div>
    </header>
  );
}

/**
 * Marks the first paint as the start of the hero entrance. Hidden start states
 * apply only under this class, so without JavaScript the hero is fully visible.
 */
const INTRO_FLAG = "document.documentElement.classList.add('intro')";

function Hero() {
  return (
    <section id="top" className="hero" aria-labelledby="hero-title">
      <script dangerouslySetInnerHTML={{ __html: INTRO_FLAG }} />
      <div className="shell">
        <p className="eyebrow hero__eyebrow">{HERO.eyebrow}</p>
        <h1 id="hero-title" className="hero__title">
          <AccentText title={HERO.title} words />
        </h1>
        <div className="hero__grid">
          <div className="hero__aside">
            <p className="hero__lede">{HERO.lede}</p>
            <div className="hero__ctas">
              <a href={HERO.primaryHref} className="button button--primary" data-magnetic>
                {HERO.primaryCta}
                <Arrow />
              </a>
              <a href={SIGN_IN_HREF} className="button button--ghost" data-magnetic>
                {HERO.secondaryCta}
              </a>
            </div>
            <ul className="promises" aria-label="Promises">
              {HERO.promises.map((p) => (
                <li key={p}>
                  <Check />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="hero__demo">
            <DraftDemo />
          </div>
        </div>
      </div>
    </section>
  );
}

/** Events that mean something is settled get a check mark on the timeline. */
const SETTLED: ReadonlySet<FollowUpEvent["kind"]> = new Set([
  "approval",
  "accepted",
  "done",
  "proof",
]);

function FollowUp() {
  const { task, labels } = FOLLOW_UP;
  const onTime = isOnTime(task);
  return (
    <section id="follow-up" className="section section--soft" aria-labelledby="follow-title">
      <div className="shell split">
        <div className="split__text" data-reveal>
          <p className="eyebrow">Follow-up</p>
          <h2 id="follow-title" className="section__title">
            {FOLLOW_UP.title}
          </h2>
          <p className="section__lede">{FOLLOW_UP.lede}</p>
          <ul className="ticks">
            {FOLLOW_UP.points.map((p) => (
              <li key={p}>
                <Check />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="escalation" data-reveal>
          <div className="escalation__task">
            <p className="escalation__title">{task.title}</p>
            <dl className="facts">
              <div className="fact">
                <dt>{labels.deadline}</dt>
                <dd className="fact__strong">{task.deadline.label}</dd>
              </div>
              <div className="fact">
                <dt>{labels.approval}</dt>
                <dd>
                  {/* Settled: show only the outcome, never a pending-style label. */}
                  <span className="state state--approved">
                    <Check />
                    {task.approval.result}
                  </span>
                  <span className="fact__note">
                    by {task.approval.by}, {task.approval.at.label}
                  </span>
                  <span className="fact__aside">{task.approval.why}</span>
                </dd>
              </div>
              <div className="fact">
                <dt>{labels.status}</dt>
                <dd>
                  <span className={`state ${onTime ? "state--done" : "state--late"}`}>
                    {onTime ? <Check /> : <Cross />}
                    {onTime ? labels.onTime : labels.late}
                  </span>
                  <span className="fact__note">
                    {task.done.at.label} by {task.done.by}, {gap(task.done.at, task.deadline)}{" "}
                    {onTime ? "before" : "after"} the deadline
                  </span>
                </dd>
              </div>
              <div className="fact">
                <dt>{labels.proof}</dt>
                <dd>
                  <span className="fact__note">
                    {task.proof.what}, added {task.proof.at.label}
                  </span>
                </dd>
              </div>
            </dl>
          </div>
          <ol className="log" aria-label={labels.log}>
            {FOLLOW_UP.log.map((entry, i) => (
              <li
                key={entry.at.label}
                className={`log__entry log__entry--${entry.kind}`}
                style={{ "--d": i } as CSSProperties}
              >
                <span aria-hidden="true" className="log__dot">
                  {SETTLED.has(entry.kind) ? <Check /> : null}
                </span>
                <span className="log__time">
                  <time>{entry.at.label}</time>
                </span>
                <span className="log__text">{entry.text}</span>
                <span className="log__status">{entry.status}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function Safety() {
  return (
    <section id="safety" className="section" aria-labelledby="safety-title">
      <div className="shell">
        <header className="section__head" data-reveal>
          <p className="eyebrow">Safety</p>
          <h2 id="safety-title" className="section__title">
            {SAFETY.title}
          </h2>
          <p className="section__lede">{SAFETY.lede}</p>
        </header>
        <div className="rules">
          <div className="rules__col rules__col--does" data-reveal>
            <h3 className="rules__title">Fudepan does</h3>
            <ul>
              {SAFETY.does.map((item) => (
                <li key={item}>
                  <Check />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rules__col rules__col--never" data-reveal>
            <h3 className="rules__title">Fudepan never</h3>
            <ul>
              {SAFETY.never.map((item) => (
                <li key={item}>
                  <Cross />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="risks" data-reveal>
          <h3 className="risks__title">{SAFETY.riskTitle}</h3>
          <dl className="risks__list">
            {SAFETY.risks.map((r) => (
              <div key={r.risk} className="risks__item">
                <dt>
                  <RiskLabel risk={r.risk} />
                </dt>
                <dd>{r.text}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function Audience() {
  return (
    <section id="for-families" className="section section--soft" aria-labelledby="audience-title">
      <div className="shell">
        <header className="section__head" data-reveal>
          <p className="eyebrow">Who it is for</p>
          <h2 id="audience-title" className="section__title">
            {AUDIENCE.title}
          </h2>
        </header>
        <div className="audience">
          {AUDIENCE.cards.map((card) => (
            <article key={card.who} className="audience__card" data-reveal>
              <h3 className="audience__who">{card.who}</h3>
              <ul className="ticks">
                {card.points.map((p) => (
                  <li key={p}>
                    <Check />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section id="begin" className="final" aria-labelledby="final-title">
      <div className="shell final__inner" data-reveal>
        <h2 id="final-title" className="final__title">
          {FINAL_CTA.title}
        </h2>
        <p className="final__text">{FINAL_CTA.text}</p>
        <a href={SIGN_IN_HREF} className="button button--light" data-magnetic>
          {FINAL_CTA.cta}
          <Arrow />
        </a>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="shell site-footer__inner">
        <p className="site-footer__line">{FOOTER.line}</p>
        <div className="kiro">
          <p className="kiro__title">{KIRO.title}</p>
          <p className="kiro__text">{KIRO.text}</p>
          <ul className="kiro__parts" aria-label="Kiro features used">
            {KIRO.parts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
        <p className="site-footer__disclaimer">{FOOTER.disclaimer}</p>
      </div>
    </footer>
  );
}
