import { Suspense } from "react";
import { safeNextPath } from "@/lib/auth/next-path";
import { getRequestLanguage } from "@/lib/family/session";
import { createTranslator } from "@/lib/i18n/messages";
import { SignUpForm } from "./signup-form";

export default function SignUpPage({ searchParams }: PageProps<"/signup">) {
  return (
    <Suspense fallback={<p role="status">…</p>}>
      <SignUp searchParams={searchParams} />
    </Suspense>
  );
}

async function SignUp({ searchParams }: Pick<PageProps<"/signup">, "searchParams">) {
  const { next } = await searchParams;
  const language = await getRequestLanguage();
  const tr = createTranslator(language);
  return (
    <>
      <h1 className="app-title">{tr.t("signup.title")}</h1>
      <p className="app-lede">{tr.t("signup.lede")}</p>
      <SignUpForm language={language} next={safeNextPath(next)} />
    </>
  );
}
