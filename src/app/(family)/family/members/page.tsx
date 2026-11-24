import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PaperLoading } from "@/app/(family)/loading-status";
import { requireFamilyContext } from "@/lib/family/session";
import { createTranslator } from "@/lib/i18n/messages";
import { memberActionsFor } from "@/lib/membership/member-actions";
import { listInvites, listMembers, listMembershipAudit } from "@/lib/membership/queries";
import { effectiveInviteState } from "@/lib/membership/invite-state";
import { recipientRouteDecision } from "@/lib/membership/routing";
import { portraitVersions } from "@/lib/portraits/service";
import { MembersManager, type MemberRow } from "./members-manager";

export default function MembersPage() {
  return (
    <Suspense fallback={<PaperLoading />}>
      <Members />
    </Suspense>
  );
}

/** Family members only. A Care_Recipient is sent back to /family. */
async function Members() {
  const outcome = await requireFamilyContext("/family/members");
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
  const decision = recipientRouteDecision(context.role, "/family/members");
  if (decision.kind === "redirect") redirect(decision.to);
  const isPrimary = context.role === "primary_caregiver";
  const [all, audit, invites, portraits] = await Promise.all([
    listMembers(supabase, context.householdId),
    isPrimary ? listMembershipAudit(supabase, context.householdId) : Promise.resolve([]),
    isPrimary ? listInvites({ householdId: context.householdId, userId: context.userId }) : Promise.resolve(null),
    portraitVersions(supabase, context.householdId).catch(() => new Map<string, string>()),
  ]);
  const inviteCount =
    invites && invites.ok
      ? invites.data.filter((i) => effectiveInviteState(i.state, new Date(i.expires_at), new Date()) === "pending").length
      : null;
  const toRecord = (m: (typeof all)[number]) => ({
    id: m.id,
    userId: m.userId,
    householdId: context.householdId,
    role: m.role,
    isActive: m.isActive,
  });
  const viewer = { id: context.memberId, userId: context.userId, householdId: context.householdId, role: context.role, isActive: true };
  const rows: MemberRow[] = all
    .filter((m) => m.isActive)
    .map((m) => ({
      id: m.id,
      name: m.displayName,
      role: m.role,
      isYou: m.id === context.memberId,
      actions: memberActionsFor(viewer, toRecord(m)),
      portraitSrc: portraits.has(m.id) ? `/family/members/${m.id}/portrait?v=${encodeURIComponent(portraits.get(m.id) ?? "")}` : null,
      // Own card for every active member; a primary caregiver also for a care recipient. The server checks again.
      canSetPortrait: m.id === context.memberId || (isPrimary && m.role === "care_recipient"),
    }));
  return (
    <MembersManager
      householdId={context.householdId}
      language={context.language}
      isPrimary={isPrimary}
      members={rows}
      inviteCount={inviteCount}
      history={audit.map((e) => ({ id: e.id, eventType: e.eventType, createdAt: e.createdAt }))}
    />
  );
}
