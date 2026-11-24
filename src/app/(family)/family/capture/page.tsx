import { Suspense } from "react";
import { PaperLoading } from "@/app/(family)/loading-status";
import { requireFamilyContext } from "@/lib/family/session";
import { createTranslator } from "@/lib/i18n/messages";
import { CaptureForm } from "./capture-form";

/** The send action schedules reading with after(), which shares this route's time limit. */
export const maxDuration = 300;

export default function CapturePage() {
  return (
    <Suspense fallback={<PaperLoading />}>
      <Capture />
    </Suspense>
  );
}

/** Every active member, including the care recipient, may photograph a note (Requirement 1.4). */
async function Capture() {
  const outcome = await requireFamilyContext("/family/capture");
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
  const { context } = outcome;
  return <CaptureForm householdId={context.householdId} language={context.language} />;
}
