import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { LocalDateTime } from "@/components/app/local-date-time";
import { safeNextPath } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";
import { getCareChainDetail } from "@/lib/care/queries";
import { getCareChainTimeline, labelForEvent } from "@/lib/care/timeline";

import { AppointmentClarifiedFacts } from "../../appointment-facts";

export const metadata: Metadata = {
  title: "Timeline — Fudepan",
};

export default function TimelinePage({ params }: PageProps<"/care/[chainId]/timeline">) {
  return (
    <Suspense fallback={<p role="status">Loading timeline…</p>}>
      <TimelineView params={params} />
    </Suspense>
  );
}

async function TimelineView({ params }: Pick<PageProps<"/care/[chainId]/timeline">, "params">) {
  const { chainId } = await params;
  const { supabase, user } = await getSession();
  if (!user)
    redirect(`/login?next=${encodeURIComponent(safeNextPath(`/care/${chainId}/timeline`))}`);

  const chain = await getCareChainDetail(supabase, chainId);
  if (!chain) notFound();

  const events = await getCareChainTimeline(supabase, chainId);

  return (
    <article aria-labelledby="timeline-title" className="grid gap-10">
      <p>
        <Link href={`/care/${chainId}`} className="app-link">
          ← Back to care chain
        </Link>
      </p>

      <header>
        <p className="app-kicker">Audit timeline</p>
        <h1 id="timeline-title" className="app-title">
          {chain.title}
        </h1>
        <p className="app-lede">
          Every important change to this care chain is recorded here and cannot be altered.
        </p>
      </header>

      {events.length === 0 ? (
        <p className="app-lede">No events recorded yet.</p>
      ) : (
        <ol aria-label="Timeline events" className="relative grid gap-0 border-l border-current pl-6">
          {events.map((event) => {
            const isEscalation = event.eventType === "step_escalated";
            const isSimulatedNotification = event.eventType === "escalation_notified";
            const isCompletion = event.eventType === "step_completed";
            const isApproval = event.eventType === "step_approved";
            const isEvidence = event.eventType === "evidence_uploaded";
            const isAiFailed = event.eventType === "extraction_failed";

            return (
              <li key={event.id} className="relative mb-8">
                {/* Timeline dot */}
                <span
                  aria-hidden="true"
                  className={`absolute -left-[1.65rem] top-1 h-3 w-3 rounded-full border-2 ${
                    isEscalation || isAiFailed
                      ? "border-orange-500 bg-orange-500"
                      : isCompletion || isApproval || isEvidence
                        ? "border-green-700 bg-green-700"
                        : "border-current bg-current"
                  }`}
                />

                <div className="app-panel grid gap-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold text-base">{labelForEvent(event.eventType)}</p>
                    <p className="app-hint text-sm">
                      <LocalDateTime iso={event.createdAt} />
                    </p>
                  </div>

                  {event.stepTitle && (
                    <p className="app-hint">Step: {event.stepTitle}</p>
                  )}

                  <dl className="app-facts text-sm">
                    <dt>By</dt>
                    <dd className="capitalize">{event.actorType}</dd>

                    {isSimulatedNotification && (
                      <>
                        <dt>Note</dt>
                        <dd className="text-amber-700">
                          Local Alpha — notification recorded but not delivered to any real contact.
                          Connect a real notification channel to send this.
                        </dd>
                      </>
                    )}

                    {event.eventType === "appointment_clarified" && (
                      <AppointmentClarifiedFacts payload={event.payload} actorName={event.actorName} />
                    )}

                    {isEvidence && typeof event.payload.content === "string" && (
                      <>
                        <dt>Evidence</dt>
                        <dd className="italic">&ldquo;{event.payload.content}&rdquo;</dd>
                      </>
                    )}

                    {event.eventType === "extraction_succeeded" &&
                      typeof event.payload.step_count === "number" && (
                        <>
                          <dt>Steps drafted</dt>
                          <dd>{event.payload.step_count}</dd>
                        </>
                      )}

                    {event.eventType === "ambiguities_detected" &&
                      Array.isArray(event.payload.ambiguities) && (
                        <>
                          <dt>Missing information</dt>
                          <dd>
                            <ul className="list-disc pl-4">
                              {(event.payload.ambiguities as { question: string }[]).map(
                                (a, i) => (
                                  <li key={i}>{a.question}</li>
                                ),
                              )}
                            </ul>
                          </dd>
                        </>
                      )}
                  </dl>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </article>
  );
}
