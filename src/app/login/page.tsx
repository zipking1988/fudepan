import type { Metadata } from "next";
import Link from "next/link";
import { SignInForm } from "@/components/SignInForm";
import { linkClass } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: t.auth.title };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-4xl font-bold">{t.auth.title}</h1>
      <p className="mt-2 text-lg text-ink-soft">{t.auth.intro}</p>
      {error ? (
        <p role="alert" className="mt-4 text-lg font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {t.auth.linkFailed}
        </p>
      ) : null}
      <div className="mt-6">
        <SignInForm next={safeNextPath(next)} />
      </div>
      <p className="mt-6 text-lg">
        <Link href="/demo" className={linkClass}>
          {t.landing.tryExample}
        </Link>
      </p>
    </div>
  );
}
