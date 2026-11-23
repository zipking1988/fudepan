import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingStatus } from "@/app/(family)/loading-status";

import { listHouseholdMemberOptions, getSharedCareEvent } from "@/lib/care/queries";
import { getEventTimeline } from "@/lib/care/timeline";
import type { ReceiverOption } from "@/lib/family/event-offers";
import { requireFamilyContext } from "@/lib/family/session";
import { isHouseholdRole } from "@/lib/households/membership";
import { createTranslator } from "@/lib/i18n/messages";

import { ConnectedEventView } from "./event-view-connected";

export default function EventPage({ params }: PageProps<"/family/events/[noteId]">) {
  return (
    <Suspense fallback={<LoadingStatus />}>
      <EventContent params={params} />
    </Suspense>
  );
}

async function EventContent({ params }: { params: PageProps<"/family/events/[noteId]">["params"] }) {
  const { noteId } = await params;
  const outcome = await requireFamilyContext(`/family/events/${noteId}`);
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
      viewer={{ memberId: context.memberId, householdId: context.householdId, role: context.role }}
      members={members}
      language={context.language}
      nowIso={new Date().toISOString()}
      timeline={timeline}
      viewerName={context.displayName}
      recipientName={options.find((m) => m.role === "care_recipient")?.displayName ?? null}
    />
  );
}
