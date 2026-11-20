import type { Metadata } from "next";
import Link from "next/link";
import { DemoReview } from "@/components/DemoReview";
import { DemoScene } from "@/components/landing/DemoScene";
import { IconArrow } from "@/components/landing/Icons";
import { localDate } from "@/lib/datetime";
import { exampleDates } from "@/lib/demo/fixtures";
import { t } from "@/lib/i18n/messages";

export const metadata: Metadata = { title: t.demo.title };
export const dynamic = "force-dynamic";

/** Public example. Fictional data only. No sign-in, no database, no AI call. */
export default function DemoPage() {
  const dates = exampleDates(new Date(), "Asia/Tokyo", localDate);

  return (
    <div className="lp">
      <section aria-labelledby="demo-title" className="lp-light full-bleed lp-demo-head">
        <div className="lp-wrap">
          <p className="lp-kicker">{t.landing.interactiveLabel}</p>
          <h1 id="demo-title" className="lp-h1">
            {t.demo.title}
          </h1>
          <p className="lp-body">{t.demo.intro}</p>
          <DemoScene referenceLabel={dates.referenceLabel} thursdayLabel={dates.thursdayLabel} />
        </div>
      </section>

      <section aria-labelledby="demo-edit-title" className="lp-light lp-light--2 full-bleed">
        <div className="lp-wrap lp-demo-edit">
          <div>
            <p className="lp-kicker">{t.demo.editKicker}</p>
            <h2 id="demo-edit-title" className="lp-h2">
              {t.demo.editTitle}
            </h2>
            <p className="lp-body">{t.demo.editIntro}</p>
            <p className="lp-body">
              {t.demo.referenceNote}: <strong className="text-sumi">{dates.referenceLabel}</strong>
            </p>
            <p className="mt-8">
              <Link href="/login" className="lp-btn lp-btn--primary">
                {t.demo.signInCta}
                <IconArrow />
              </Link>
            </p>
          </div>
          <div className="lp-form">
            <DemoReview dueDate={dates.thursday} />
          </div>
        </div>
      </section>
    </div>
  );
}
