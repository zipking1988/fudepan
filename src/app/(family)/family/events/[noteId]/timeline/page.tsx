import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LoadingStatus } from "@/app/(family)/loading-status";

import { getEventTimeline } from "@/lib/care/timeline";
import { requireFamilyContext } from "@/lib/family/session";
import { isUuid } from "@/lib/ids";
import { createTranslator } from "@/lib/i18n/messages";

import { EventTimelineView } from "./event-timeline-view";

export default function EventTimelinePage({ params }: { params: Promise<{ noteId: string }> }) {
  return (
    <Suspense fallback={<LoadingStatus />}>
      <EventTimeline params={params} />
    </Suspense>
  );
}

async function EventTimeline({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  if (!isUuid(noteId)) notFound();
  const outcome = await requireFamilyContext(`/family/events/${noteId}/timeline`);
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
  const { supabase, context } = outcome;

  // RLS client: a note of another household is simply not visible.
  const { data: note, error } = await supabase.from("notes").select("id").eq("id", noteId).maybeSingle();
  if (error) throw new Error("timeline_note_query_failed");
  if (!note) notFound();

  const entries = await getEventTimeline(supabase, noteId, {
    leftSuffix: createTranslator(context.language).t("member.leftSuffix"),
  });
  return (
    <EventTimelineView entries={entries} language={context.language} eventHref={`/family/events/${noteId}`} />
  );
}
