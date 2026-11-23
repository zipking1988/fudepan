import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { familyLinks } from "@/lib/family/session-core";
import type { HouseholdRole } from "@/lib/households/membership";
import type { Language } from "@/lib/i18n/format";
import { createTranslator } from "@/lib/i18n/messages";
import { FamilyNav } from "./family-nav";

/** Skip link, header with navigation and sign-out. Pure: the layout supplies role and language. */
export function FamilyHeader({
  role,
  language,
  unseenReminders = 0,
}: {
  role: HouseholdRole | null;
  language: Language;
  unseenReminders?: number;
}) {
  const tr = createTranslator(language);
  const items = role ? familyLinks(role).map((l) => ({ href: l.href, label: tr.t(l.labelKey) })) : [];
  return (
    <>
      <a href="#main" className="app-skip">
        {tr.t("nav.skip")}
      </a>
      <header className="app-header">
        <Link href="/family" className="app-wordmark">
          Fudepan
        </Link>
        {items.length > 0 ? <FamilyNav label={tr.t("nav.label")} items={items} /> : <span className="app-nav" />}
        {unseenReminders > 0 && (
          <p role="status" className="app-lede m-0">
            {tr.tCount("nav.reminders", unseenReminders)}
          </p>
        )}
        {role && (
          <form action={signOut}>
            <button type="submit" className="app-button app-button--quiet">
              {tr.t("nav.signOut")}
            </button>
          </form>
        )}
      </header>
    </>
  );
}

export function FamilyMain({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="app-main">
      {children}
    </main>
  );
}
