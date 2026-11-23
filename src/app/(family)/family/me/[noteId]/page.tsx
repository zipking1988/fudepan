import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingStatus } from "@/app/(family)/loading-status";
import { getSharedCareEvent } from "@/lib/care/queries";
import { meRouteDecision } from "@/lib/family/recipient-routing";
import { requireFamilyContext } from "@/lib/family/session";
import { createTranslator } from "@/lib/i18n/messages";
import { RecipientEventView } from "../../recipient-view";

export default function RecipientEventPage({ params }: PageProps<"/family/me/[noteId]">) {
  return (
    <Suspense fallback={<LoadingStatus />}>
      <RecipientEventContent params={params} />
    </Suspense>
  );
}

async function RecipientEventContent({ params }: { params: PageProps<"/family/me/[noteId]">["params"] }) {
  const { noteId } = await params;
  const outcome = await requireFamilyContext(`/family/me/${noteId}`);
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
  const { context, supabase } = outcome;
  const decision = meRouteDecision(context.role, noteId);
  if (decision.kind === "redirect") redirect(decision.to);
  const event = await getSharedCareEvent(supabase, noteId);
  if (!event || event.householdId !== context.householdId) notFound();
  return <RecipientEventView event={event} language={context.language} />;
}
