import { Suspense } from "react";
import { LoadingStatus } from "@/app/(family)/loading-status";
import { getFamilyFeed } from "@/lib/family/feed";
import { requireFamilyContext } from "@/lib/family/session";
import { createTranslator } from "@/lib/i18n/messages";
import { FamilyFeedView } from "./family-feed-view";
import { RecipientHome } from "./recipient-home";

export default function FamilyHomePage() {
  return (
    <Suspense fallback={<LoadingStatus />}>
      <FamilyHome />
    </Suspense>
  );
}

async function FamilyHome() {
  const outcome = await requireFamilyContext("/family");
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
  const ctx = outcome.context;
  if (ctx.role === "care_recipient") return <RecipientHome context={ctx} supabase={outcome.supabase} />;

  const feed = await getFamilyFeed(outcome.supabase, ctx.householdId, ctx.memberId);
  return (
    <FamilyFeedView
      feed={feed}
      language={ctx.language}
      householdId={ctx.householdId}
      memberName={ctx.displayName}
    />
  );
}
