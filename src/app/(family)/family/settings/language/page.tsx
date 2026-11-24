import { Suspense } from "react";
import { LoadingStatus } from "@/app/(family)/loading-status";
import { redirect } from "next/navigation";
import { requireFamilyContext } from "@/lib/family/session";
import { recipientRouteDecision } from "@/lib/membership/routing";
import { createTranslator } from "@/lib/i18n/messages";
import { LanguageForm } from "./language-form";

export default function LanguagePage() {
  return (
    <Suspense fallback={<LoadingStatus />}>
      <LanguageSettings />
    </Suspense>
  );
}

/** Family members only. A care recipient is sent back to /family. */
async function LanguageSettings() {
  const outcome = await requireFamilyContext("/family/settings/language");
  if (outcome.kind !== "ok") {
    const tr = createTranslator(outcome.language);
    const key = outcome.kind === "no_household" ? "family.noHousehold" : "family.notMember";
    return (
      <>
        <h1 className="app-title">{tr.t(`${key}.title`)}</h1>
        <p className="app-lede">{tr.t(`${key}.body`)}</p>
      </>
    );
  }
  const { context } = outcome;
  const decision = recipientRouteDecision(context.role, "/family/settings/language");
  if (decision.kind === "redirect") redirect(decision.to);
  return <LanguageForm householdId={context.householdId} language={context.language} />;
}
