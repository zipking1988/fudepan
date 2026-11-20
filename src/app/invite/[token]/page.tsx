import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInvitationForm } from "@/components/AcceptInvitationForm";
import { primaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { getAuthContext } from "@/server/session";

export const metadata: Metadata = { title: t.household.acceptTitle };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(token);
  const auth = await getAuthContext();

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-4xl font-bold">{t.household.acceptTitle}</h1>
      {!valid ? (
        <p role="alert" className="paper-card mt-6 p-6 text-lg">
          {t.household.invalidLink}
        </p>
      ) : auth.status === "signed_in" ? (
        <div className="mt-6">
          <AcceptInvitationForm token={token} />
        </div>
      ) : (
        <div className="paper-card mt-6 p-6">
          <p className="text-lg">{t.household.acceptSignIn}</p>
          <p className="mt-4">
            <Link
              href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
              className={primaryButton}
            >
              {t.auth.signIn}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
