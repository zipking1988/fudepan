import "./landing.css";
import Image from "next/image";
import Link from "next/link";
import type { Language } from "@/lib/i18n/format";
import { CareExample } from "./care-example";
import { COPY, EXAMPLE_COPY, IMAGE_SIZE, IMAGES, LINKS } from "./content";
import type { PersonId } from "./example";
import { ArrowDown, BrushTicks, Camera, Chevron, Globe, Hourglass, Shield } from "./icons";
import { landingFontClasses } from "./landing-fonts";
import { Wordmark } from "./wordmark";

export { Wordmark };

/**
 * The public landing page, in Japanese at "/" and English at "/en". It has a
 * hero, a working example with a made-up family, a short "how it works" with
 * the cases that need confirmation, and the login link.
 */
export function Landing({ lang, demoConfigured = false }: { lang: Language; demoConfigured?: boolean }) {
  const copy = COPY[lang];
  return (
    <div className={`lp ${landingFontClasses}`} lang={lang}>
      <a href="#main" className="lp-skip">
        {copy.skip}
      </a>
      <SiteHeader lang={lang} />
      <main id="main" tabIndex={-1}>
        <Hero lang={lang} />
        <ExampleSection lang={lang} demoConfigured={demoConfigured} />
        <HowItWorks lang={lang} />
      </main>
      <SiteFooter lang={lang} />
    </div>
  );
}

function SiteHeader({ lang }: { lang: Language }) {
  const { nav } = COPY[lang];
  return (
    <header className="lp-header">
      <div className="lp-shell lp-header__bar">
        <Wordmark lang={lang} />
        <nav aria-label={nav.label}>
          <ul className="lp-nav">
            <li className="lp-nav__how">
              <a href={LINKS.how}>{nav.how}</a>
            </li>
            <li>
              <Link href={LINKS.home[nav.other.lang]} hrefLang={nav.other.lang} lang={nav.other.lang} className="lp-lang">
                <Globe />
                {nav.other.label}
              </Link>
            </li>
            <li>
              <Link href={LINKS.login} className="lp-btn lp-btn--outline lp-btn--small">
                {nav.login}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

const FAMILY: PersonId[] = ["misa", "kenta", "yui"];

function Hero({ lang }: { lang: Language }) {
  const { hero } = COPY[lang];
  const people = EXAMPLE_COPY[lang].people;
  return (
    <section className="lp-hero" aria-labelledby="hero-title">
      <div className="lp-shell lp-hero__grid">
        <div className="lp-hero__copy">
          <h1 id="hero-title" className="lp-hero__title">
            <span className="lp-hero__line">{hero.title.line1}</span>{" "}
            <span className="lp-hero__line">
              {hero.title.before}
              <span className="lp-mark lp-mark--violet">{hero.title.mark}</span>
              {hero.title.after}
            </span>
          </h1>
          <p className="lp-hero__lede">
            <span>{hero.lede[0]}</span>
            <span>{hero.lede[1]}</span>
          </p>
          <a href={LINKS.example} className="lp-btn lp-btn--navy lp-btn--large">
            {hero.cta}
            <ArrowDown />
          </a>
        </div>
        <div className="lp-hero__art">
          <div className="lp-hero__photo">
            <Image
              src={IMAGES.hero}
              alt={hero.photoAlt}
              {...IMAGE_SIZE.grandma}
              priority
              sizes="(min-width: 860px) 34rem, 92vw"
            />
            <BrushTicks className="lp-hero__ticks" />
          </div>
          <div className="lp-hero__note">
            <Image src={IMAGES.note} alt={hero.noteAlt} {...IMAGE_SIZE.note} sizes="(min-width: 860px) 17rem, 55vw" />
          </div>
          <ul className="lp-hero__family" aria-label={hero.familyLabel}>
            {FAMILY.map((id) => (
              <li key={id} className={`lp-hero__person lp-hero__person--${id}`}>
                <Image src={IMAGES.people[id]} alt="" {...IMAGE_SIZE.person} sizes="7rem" />
                <span>{people[id]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <svg className="lp-wave" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M0 46C180 12 380 6 620 30s520 46 820 2V80H0Z" />
      </svg>
    </section>
  );
}

function ExampleSection({ lang, demoConfigured }: { lang: Language; demoConfigured: boolean }) {
  const { example } = COPY[lang];
  return (
    <section id="example" className="lp-example" aria-labelledby="example-title" tabIndex={-1}>
      <div className="lp-shell">
        <header className="lp-example__head">
          <h2 id="example-title" className="lp-example__title">
            <span className="lp-mark lp-mark--ember">{example.title.mark}</span>
            {example.title.after}
          </h2>
          <p className="lp-example__lede">{example.lede}</p>
          <p className="lp-example__fictional">{example.fictional}</p>
        </header>
        <CareExample lang={lang} demoConfigured={demoConfigured} />
        <div className="lp-example__cta">
          {/* The full /demo is in Japanese, so only the Japanese landing links to it. */}
          {example.fullDemo && (
            <>
              <Link href={LINKS.demo.ja} className="lp-btn lp-btn--ember lp-btn--large">
                {example.fullDemo.cta}
                <Chevron />
              </Link>
              <p>{example.fullDemo.note}</p>
            </>
          )}
          {/* The real capture page, kept outside the made-up example above. */}
          <p className="lp-example__actual">
            <Link href={LINKS.capture} prefetch={false} className="lp-example__actualLink">
              <Camera />
              {example.actual.link}
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}

function HowItWorks({ lang }: { lang: Language }) {
  const { how } = COPY[lang];
  return (
    <section id="how" className="lp-how" aria-labelledby="how-title">
      <div className="lp-shell">
        <h2 id="how-title" className="lp-how__title">
          {how.title}
        </h2>
        <ol className="lp-how__steps">
          {how.steps.map((step, i) => (
            <li key={step.title} className="lp-how__step">
              <span className="lp-how__num" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="lp-how__stepTitle">{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
        <section className="lp-confirm" aria-labelledby="confirm-title">
          <h3 id="confirm-title" className="lp-confirm__title">
            <Shield />
            {how.confirm.title}
          </h3>
          <p>{how.confirm.text}</p>
          <ul className="lp-confirm__list">
            {how.confirm.items.map((item) => (
              <li key={item}>
                <Hourglass />
                {item}
              </li>
            ))}
          </ul>
          <p className="lp-confirm__medical">{how.confirm.medical}</p>
        </section>
        <KiroEvidence lang={lang} />
      </div>
    </section>
  );
}

/**
 * "Built with Kiro": one requirement from the Kiro spec, the example above that
 * follows it, and the test of the rule. Paths are shown as text, not links.
 */
function KiroEvidence({ lang }: { lang: Language }) {
  const { kiro } = COPY[lang].how;
  return (
    <section className="lp-kiro" aria-labelledby="kiro-title">
      <h3 id="kiro-title" className="lp-kiro__title">
        {kiro.title}
      </h3>
      <p>{kiro.lede}</p>
      <ol className="lp-kiro__steps">
        {kiro.steps.map((step) => (
          <li key={step.label} className="lp-kiro__step">
            <span className="lp-kiro__label">{step.label}</span>
            <p>{step.text}</p>
            {step.quote && (
              <blockquote className="lp-kiro__quote" lang="en">
                {step.quote}
              </blockquote>
            )}
            <code className="lp-kiro__path">{step.path}</code>
            {step.detail && <p className="lp-kiro__detail">{step.detail}</p>}
          </li>
        ))}
      </ol>
      <p className="lp-kiro__honest">{kiro.honest}</p>
    </section>
  );
}

function SiteFooter({ lang }: { lang: Language }) {
  const { footer } = COPY[lang];
  return (
    <footer className="lp-footer">
      <div className="lp-shell lp-footer__inner">
        <Wordmark lang={lang} />
        <nav aria-label={footer.navLabel}>
          <ul className="lp-footer__links">
            <li>
              <a href={LINKS.how}>{footer.links.how}</a>
            </li>
            <li>
              {/* English stays on its own interactive example; /demo is in Japanese. */}
              {lang === "ja" ? (
                <Link href={LINKS.demo.ja}>{footer.links.demo}</Link>
              ) : (
                <a href={LINKS.demo.en}>{footer.links.demo}</a>
              )}
            </li>
            <li>
              <Link href={LINKS.login}>{footer.links.login}</Link>
            </li>
          </ul>
        </nav>
        <p className="lp-footer__line">{footer.line}</p>
      </div>
    </footer>
  );
}
