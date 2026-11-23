import Link from "next/link";
import { createTranslator } from "@/lib/i18n/messages";

/** A not-found page cannot read the member's language, so both languages are written out. */
export default function FamilyNotFound() {
  return (
    <div className="grid gap-8">
      {(["ja", "en"] as const).map((lang) => {
        const tr = createTranslator(lang);
        return (
          <section key={lang} lang={lang}>
            <h1 className="app-title">{tr.t("family.notFound.title")}</h1>
            <p className="app-lede">{tr.t("family.notFound.body")}</p>
            <p className="mt-6">
              <Link href="/family" className="app-link">
                {tr.t("family.notFound.back")}
              </Link>
            </p>
          </section>
        );
      })}
    </div>
  );
}
