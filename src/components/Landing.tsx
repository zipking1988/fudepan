import Link from "next/link";
import { FamilySection } from "@/components/landing/FamilySection";
import { HeroScroll } from "@/components/landing/HeroScroll";
import { IconArrow } from "@/components/landing/Icons";
import { ScamSection } from "@/components/landing/ScamSection";
import { Stat } from "@/components/landing/Stat";
import { TrySection } from "@/components/landing/TrySection";
import { localDate } from "@/lib/datetime";
import { exampleDates } from "@/lib/demo/fixtures";
import { t } from "@/lib/i18n/messages";

/** The public landing page for visitors who are not signed in. */
export function Landing() {
  const dates = exampleDates(new Date(), "Asia/Tokyo", localDate);
  return (
    <div className="lp">
      <HeroScroll referenceLabel={dates.referenceLabel} thursdayLabel={dates.thursdayLabel} />
      <div id="after-hero" className="lp-anchor" tabIndex={-1} />
      <ScamSection />
      <FamilySection />
      <TrySection />

      <section aria-labelledby="final-title" className="lp-dark full-bleed lp-final">
        <div className="lp-wrap lp-final-grid">
          <h2 id="final-title" className="lp-display lp-display--final">
            <span className="block">{t.landing.finalTitle}</span>{" "}
            <span className="block text-on-night-2">{t.landing.finalTitle2}</span>
          </h2>
          <div className="lp-final-side">
            <Stat id="livingAlone" tone="dark" />
            <div className="lp-final-cta">
              <p className="lp-body lp-body--dark">{t.landing.safetyBody}</p>
              <div className="lp-actions">
                <Link href="/demo" className="lp-btn lp-btn--light">
                  {t.landing.tryExample}
                  <IconArrow />
                </Link>
                <Link href="/login?next=%2F%23add-note" className="lp-btn lp-btn--ghost-dark">
                  {t.landing.upload}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
