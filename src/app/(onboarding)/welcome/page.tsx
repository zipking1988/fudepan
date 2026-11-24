import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getSession } from "@/lib/auth/session";
import { getRequestLanguage } from "@/lib/family/session";
import { listMemberships } from "@/lib/households/queries";
import { createTranslator } from "@/lib/i18n/messages";
import { WelcomeForm } from "./welcome-form";

export default function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  return (
    <Suspense fallback={<p role="status">…</p>}>
      <Welcome searchParams={searchParams} />
    </Suspense>
  );
}

async function Welcome({ searchParams }: Pick<PageProps<"/welcome">, "searchParams">) {
  const { left } = await searchParams;
  const { supabase, user } = await getSession();
  if (!user) redirect("/login?next=%2Fwelcome");
  // Someone who already belongs to a household has nothing to create here.
  const memberships = await listMemberships(supabase, user.id).catch(() => []);
  if (memberships.length > 0 && left !== "1") redirect("/family");

  const language = await getRequestLanguage();
  const tr = createTranslator(language);
  return (
    <>
      <h1 className="app-title">{tr.t("welcome.title")}</h1>
      {left === "1" && (
        <div role="status" className="app-success">
          <p className="app-alert__title">{tr.t("welcome.left.title")}</p>
          <p>{tr.t("welcome.left.body")}</p>
        </div>
      )}
      <p className="app-lede">{tr.t("welcome.lede")}</p>
      <WelcomeForm language={language} />
    </>
  );
}
