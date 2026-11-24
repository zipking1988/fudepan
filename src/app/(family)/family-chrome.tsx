import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import type { HouseholdRole } from "@/lib/households/membership";
import type { Language } from "@/lib/i18n/format";
import { createTranslator } from "@/lib/i18n/messages";
import { Wordmark } from "@/components/landing/wordmark";
import { AccountMenu } from "./account-menu";
import { FamilyNav } from "./family-nav";
import { Avatar } from "./family/playful/ui";

export type HeaderWho = { name: string; memberId: string; householdId: string; portraitSrc?: string | null };

/** Skip link, header with navigation and the account menu. Pure: the layout supplies role and language. */
export function FamilyHeader({
  role,
  language,
  unseenReminders = 0,
  who = null,
}: {
  role: HouseholdRole | null;
  language: Language;
  unseenReminders?: number;
  who?: HeaderWho | null;
}) {
  const tr = createTranslator(language);
  const recipient = role === "care_recipient";
  const items = role
    ? [
        { href: "/family", label: tr.t(recipient ? "pb.nav.home" : "pb.nav.notes") },
        ...(recipient ? [] : [{ href: "/family/members", label: tr.t("pb.nav.members") }]),
      ]
    : [];
  return (
    <>
      <a href="#main" className="app-skip">
        {tr.t("nav.skip")}
      </a>
      <header className="lp-header pb-header">
        <div className="lp-shell lp-header__bar pb-header__bar">
          <Wordmark lang={language} />
          <div className="pb-header__right">
            {items.length > 0 ? <FamilyNav label={tr.t("nav.label")} items={items} /> : null}
            {unseenReminders > 0 && (
              <p role="status" className="pb-header__status">
                {tr.tCount("nav.reminders", unseenReminders)}
              </p>
            )}
            {role && (
              <AccountMenu
                name={who?.name ?? tr.t("pb.you")}
                label={tr.t("pb.nav.account", { name: who?.name ?? tr.t("pb.you") })}
                avatar={
                  <Avatar name={who?.name ?? null} householdId={who?.householdId} memberId={who?.memberId} src={who?.portraitSrc ?? null} size={40} />
                }
              >
                {!recipient && (
                  <Link href="/family/settings/language" className="pb-account__item">
                    {tr.t("pb.nav.language")}
                  </Link>
                )}
                <form action={signOut}>
                  <button type="submit" className="pb-account__item">
                    {tr.t("pb.nav.signOut")}
                  </button>
                </form>
              </AccountMenu>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

export function FamilyMain({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="pb-main">
      {children}
    </main>
  );
}
