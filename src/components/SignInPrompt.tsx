import Link from "next/link";
import { primaryButton, secondaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";

type Status = "unconfigured" | "signed_out" | "no_household";

/** Replaces dead ends: tells people what to do next, with a real link. */
export function SignInPrompt({ status, next = "/" }: { status: Status; next?: string }) {
  return (
    <div role="status" className="paper-card mt-6 p-6">
      <p className="text-lg">{t.inbox.notReady[status]}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {status === "signed_out" ? (
          <Link href={`/login?next=${encodeURIComponent(next)}`} className={primaryButton}>
            {t.auth.signIn}
          </Link>
        ) : null}
        {status === "no_household" ? (
          <Link href="/" className={primaryButton}>
            {t.household.create}
          </Link>
        ) : null}
        <Link href="/demo" className={secondaryButton}>
          {t.landing.tryExample}
        </Link>
      </div>
    </div>
  );
}
