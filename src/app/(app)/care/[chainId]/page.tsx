import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { LocalDateTime } from "@/components/app/local-date-time";
import { safeNextPath } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";
import { type RiskLevel } from "@/lib/care/risk";
import { chainStatusText } from "@/lib/care/chain-summary";
import { getCareChainDetail, listHouseholdMemberOptions } from "@/lib/care/queries";

import { AppointmentStepFacts } from "../appointment-facts";
import { CareChainActions } from "./care-chain-actions";
import { EscalationCheckButton } from "./escalation-check-button";
import { AwaitingApprovalBanner, AwaitingApprovalNotice, RiskBadge, StepStatusBadge } from "./step-status";

export const metadata: Metadata = {
  title: "Care Chain — Fudepan",
};

export default function CareChainPage({ params }: PageProps<"/care/[chainId]">) {
  return (
    <Suspense fallback={<p role="status">Loading care chain…</p>}>
      <CareChainView params={params} />
    </Suspense>
  );
}

async function CareChainView({ params }: Pick<PageProps<"/care/[chainId]">, "params">) {
  const { chainId } = await params;
  const { supabase, user } = await getSession();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(`/care/${chainId}`))}`);

  const chain = await getCareChainDetail(supabase, chainId);
  if (!chain) notFound();

  const members = await listHouseholdMemberOptions(supabase, chain.householdId);

  const missingOwners = chain.steps.filter((s) => !s.ownerId);

  return (
    <article aria-labelledby="chain-title" className="grid gap-10">
      <p>
        <Link href={`/notes/${chain.noteId}`} className="app-link">
          ← Back to note
        </Link>
      </p>

      <header>
        <p className="app-kicker">Care Chain</p>
        <h1 id="chain-title" className="app-title">
          {chain.title}
        </h1>
        <p className="mt-3 flex flex-wrap items-center gap-3">
          <RiskBadge level={chain.riskLevel as RiskLevel} />
          <StatusBadge status={chain.status} />
          <Link href={`/care/${chain.id}/timeline`} className="app-link text-sm">
            View full timeline
          </Link>
        </p>
        <div className="mt-4">
          <EscalationCheckButton householdId={chain.householdId} />
        </div>
      </header>

      {/* Warnings */}
      <AwaitingApprovalBanner steps={chain.steps} />

      {missingOwners.length > 0 && (
        <div role="status" className="app-panel border-amber-400">
          <p className="font-semibold">Needs attention — {missingOwners.length} step{missingOwners.length > 1 ? "s" : ""} without an owner</p>
          <p className="app-hint mt-1">
            Assign a family member to each step so it has a responsible person.
          </p>
        </div>
      )}

      {/* Steps */}
      <section aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="app-subtitle">
          Care steps
        </h2>

        {chain.steps.length === 0 ? (
          <p className="app-lede">No steps in this care chain.</p>
        ) : (
          <ol className="mt-6 grid gap-6" aria-label="Care steps">
            {chain.steps.map((step, i) => (
              <li key={step.id}>
                <article
                  aria-labelledby={`step-title-${step.id}`}
                  className="app-panel grid gap-4"
                >
                  <header>
                    <p className="app-kicker">Step {i + 1}</p>
                    <h3 id={`step-title-${step.id}`} className="app-subtitle">
                      {step.title}
                    </h3>
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <RiskBadge level={step.riskLevel as RiskLevel} />
                      <StepStatusBadge step={step} />
                      {step.confidence !== null && (
                        <span className="app-hint text-sm">
                          Confidence: {Math.round(step.confidence * 100)}%
                        </span>
                      )}
                    </p>
                  </header>

                  {step.description && (
                    <p className="text-base leading-relaxed">{step.description}</p>
                  )}

                  <dl className="app-facts">
                    <dt>Category</dt>
                    <dd className="capitalize">{step.careCategory.replace(/_/g, " ")}</dd>

                    {step.dueAt && (
                      <>
                        <dt>Due</dt>
                        <dd>
                          <LocalDateTime iso={step.dueAt} />
                        </dd>
                      </>
                    )}

                    {step.careCategory === "appointment" && (
                      <AppointmentStepFacts
                        location={step.appointmentLocation}
                        appointmentTime={step.appointmentTime}
                        appointmentTimezone={step.appointmentTimezone}
                      />
                    )}

                    <dt>Responsible person</dt>
                    <dd>
                      {step.ownerName ?? (
                        <span className="text-amber-700 font-semibold">Not assigned yet</span>
                      )}
                    </dd>

                    {step.backupOwnerName && (
                      <>
                        <dt>Backup person</dt>
                        <dd>{step.backupOwnerName}</dd>
                      </>
                    )}

                    {step.sourceQuote && (
                      <>
                        <dt>From the note</dt>
                        <dd>
                          <blockquote className="app-hint italic border-l-2 border-current pl-3">
                            &ldquo;{step.sourceQuote}&rdquo;
                          </blockquote>
                        </dd>
                      </>
                    )}

                    {step.evidenceRequired.length > 0 && (
                      <>
                        <dt>Evidence needed</dt>
                        <dd>
                          <ul className="list-disc pl-4">
                            {step.evidenceRequired.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        </dd>
                      </>
                    )}
                  </dl>

                  {/* Interactive actions (client component) */}
                  <CareChainActions
                    step={step}
                    members={members}
                  />

                  <AwaitingApprovalNotice step={step} />
                </article>
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="app-status">{chainStatusText(status)}</span>
  );
}
