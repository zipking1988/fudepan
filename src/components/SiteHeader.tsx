import Link from "next/link";
import { HouseholdSwitcher } from "@/components/HouseholdSwitcher";
import { t } from "@/lib/i18n/messages";
import { getSessionContext } from "@/server/session";

const navLink =
  "inline-flex min-h-11 min-w-11 items-center rounded-md px-4 py-2 text-lg font-semibold text-sage-800 underline-offset-4 hover:bg-sage-100 hover:underline";

export async function SiteHeader() {
  const session = await getSessionContext();
  const member = session.status === "ready";
  const links = [
    { href: "/", label: member ? t.nav.inbox : t.nav.home },
    ...(member
      ? [
          { href: "/board", label: t.nav.board },
          { href: "/settings", label: t.nav.settings },
        ]
      : []),
  ];

  const brand = (
    <Link href="/" className="lp-brand" aria-label={`${t.appName}, home`}>
      <span aria-hidden="true" className="lp-brand-mark">
        筆
      </span>
      <span className="lp-brand-name">{t.appName}</span>
    </Link>
  );

  // Visitors: one quiet row that sits on the landing page's paper background.
  if (session.status === "signed_out" || session.status === "unconfigured") {
    return (
      <header className="lp-header">
        <div className="lp-header-row">
          {brand}
          <nav aria-label={t.nav.label}>
            <ul className="flex items-center gap-1 sm:gap-2">
              <li>
                <Link href="/demo" className="lp-nav-link">
                  {t.nav.example}
                </Link>
              </li>
              {session.status === "signed_out" ? (
                <li>
                  <Link href="/login" className="lp-nav-cta">
                    {t.auth.signIn}
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
        </div>
      </header>
    );
  }

  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {brand}
          <div className="flex flex-wrap items-center gap-3">
            {session.status === "ready" ? (
              <>
                <HouseholdSwitcher
                  memberships={session.memberships}
                  activeId={session.householdId}
                />
                <p className="text-lg" data-testid="active-household">
                  {session.householdName}
                  <span className="ml-2 rounded-full bg-sage-50 px-3 py-1 font-semibold text-sage-900">
                    {t.household.roles[session.role]}
                  </span>
                </p>
              </>
            ) : null}
            <form method="post" action="/auth/signout">
              <button
                type="submit"
                className="inline-flex min-h-11 min-w-11 items-center rounded-md border-2 border-edge px-4 text-lg font-semibold text-ink hover:bg-paper-shade"
              >
                {t.auth.signOut}
              </button>
            </form>
          </div>
        </div>
        <nav aria-label={t.nav.label}>
          <ul className="flex flex-wrap gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className={navLink}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
