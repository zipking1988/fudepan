import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PaperLoading } from "@/app/(family)/loading-status";

import { listHouseholdMemberOptions, getSharedCareEvent } from "@/lib/care/queries";
import { getEventTimeline } from "@/lib/care/timeline";
import type { ReceiverOption } from "@/lib/family/event-offers";
import { requireFamilyContext } from "@/lib/family/session";
import { isHouseholdRole } from "@/lib/households/membership";
import { createTranslator } from "@/lib/i18n/messages";

import { ConnectedEventView } from "./event-view-connected";

export default function EventPage({ params, searchParams }: PageProps<"/family/events/[noteId]">) {
  return (
    <Suspense fallback={<PaperLoading />}>
      <EventContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function EventContent({
  params,
  searchParams,
}: {
  params: PageProps<"/family/events/[noteId]">["params"];
  searchParams: PageProps<"/family/events/[noteId]">["searchParams"];
}) {
  const { noteId } = await params;
  const { task } = await searchParams;
  const outcome = await requireFamilyContext(`/family/events/${noteId}`);
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
  if (context.role === "care_recipient") redirect(`/family/me/${noteId}`);

  const event = await getSharedCareEvent(supabase, noteId);
  if (!event || event.householdId !== context.householdId) notFound();

  const [options, timeline] = await Promise.all([
    listHouseholdMemberOptions(supabase, context.householdId),
    getEventTimeline(supabase, noteId).catch(() => []),
  ]);
  const members: ReceiverOption[] = options
    .filter((m) => isHouseholdRole(m.role))
    .map((m) => ({ id: m.id, name: m.displayName, role: m.role as ReceiverOption["role"] }));

  return (
    <ConnectedEventView
      event={event}
      viewer={{ memberId: context.memberId, householdId: context.householdId, role: context.role, name: context.displayName }}
      members={members}
      language={context.language}
      nowIso={new Date().toISOString()}
      timeline={timeline}
      initialTaskId={typeof task === "string" ? task : null}
    />
  );
}
