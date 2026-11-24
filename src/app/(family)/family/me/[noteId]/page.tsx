import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PaperLoading } from "@/app/(family)/loading-status";
import { getSharedCareEvent } from "@/lib/care/queries";
import { meRouteDecision } from "@/lib/family/recipient-routing";
import { requireFamilyContext } from "@/lib/family/session";
import { createTranslator } from "@/lib/i18n/messages";
import { Postcard } from "../../playful/postcard";
import { Icon } from "../../playful/ui";
import Link from "next/link";

export default function RecipientEventPage({ params }: PageProps<"/family/me/[noteId]">) {
  return (
    <Suspense fallback={<PaperLoading />}>
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
      <div className="pb-state">
        <h1 className="pb-state__title">{tr.t(`${key}.title`)}</h1>
        <p>{tr.t(`${key}.body`)}</p>
      </div>
    );
  }
  const { context, supabase } = outcome;
  const decision = meRouteDecision(context.role, noteId);
  if (decision.kind === "redirect") redirect(decision.to);
  const event = await getSharedCareEvent(supabase, noteId);
  if (!event || event.householdId !== context.householdId) notFound();
  const tr = createTranslator(context.language);
  return (
    <div className="pb-recipient">
      <div className="pb-recipient__bar">
        <Link href="/family" className="pb-back">
          <Icon name="chevronLeft" size={20} /> {tr.t("recipient.back")}
        </Link>
        <Link href="/family/capture" className="pb-btn pb-btn--outline">
          <Icon name="camera" size={22} /> {tr.t("pb.card.camera")}
        </Link>
      </div>
      <Postcard event={event} language={context.language} householdId={context.householdId} />
    </div>
  );
}
