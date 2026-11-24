import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoadingStatus } from "@/app/(family)/loading-status";
import { requireFamilyContext } from "@/lib/family/session";
import { createTranslator } from "@/lib/i18n/messages";
import { effectiveInviteState } from "@/lib/membership/invite-state";
import { listMembers, listInvites } from "@/lib/membership/queries";
import { recipientRouteDecision } from "@/lib/membership/routing";
import { InviteManager, type InviteRow } from "./invite-manager";

export default function InvitesPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  return (
    <Suspense fallback={<LoadingStatus />}>
      <Invites searchParams={searchParams} />
    </Suspense>
  );
}

/** Primary caregivers only. Everyone else is sent back to /family. */
async function Invites({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const outcome = await requireFamilyContext("/family/invites");
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
  const decision = recipientRouteDecision(context.role, "/family/invites");
  if (decision.kind === "redirect" || context.role !== "primary_caregiver") redirect("/family");
  const tr = createTranslator(context.language);
  const { role } = await searchParams;
  const [members, invites] = await Promise.all([
    listMembers(supabase, context.householdId),
    listInvites({ householdId: context.householdId, userId: context.userId }),
  ]);
  const names = new Map(members.map((m) => [m.id, m.isActive ? m.displayName : `${m.displayName} ${tr.t("member.leftSuffix")}`]));
  const rows: InviteRow[] = invites.ok
    ? [...invites.data]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((i) => ({
          id: i.id,
          role: i.role,
          creatorName: names.get(i.creator_member_id) ?? "",
          createdAt: i.created_at,
          expiresAt: i.expires_at,
          state: effectiveInviteState(i.state, new Date(i.expires_at), new Date()),
        }))
    : [];
  return (
    <InviteManager
      householdId={context.householdId}
      language={context.language}
      initialRole={role === "care_recipient" ? "care_recipient" : "family_member"}
      invites={rows}
      listFailed={!invites.ok}
    />
  );
}
