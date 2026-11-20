import type { Metadata } from "next";
import { InviteForm } from "@/components/InviteForm";
import { MemberRoleForm } from "@/components/MemberRoleForm";
import { RevokeInvitationButton } from "@/components/RevokeInvitationButton";
import { SignInPrompt } from "@/components/SignInPrompt";
import { formatTimestamp } from "@/lib/format";
import { resolveTimeZone } from "@/lib/datetime";
import { t } from "@/lib/i18n/messages";
import { hasPermission, roleSchema } from "@/lib/permissions";
import { listMembers } from "@/server/tasks/queries";
import { getSessionContext } from "@/server/session";

export const metadata: Metadata = { title: t.settings.title };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSessionContext();
  if (session.status !== "ready") {
    return (
      <>
        <h1 className="text-4xl font-bold">{t.settings.title}</h1>
        <SignInPrompt status={session.status} next="/settings" />
      </>
    );
  }

  const coordinator = hasPermission(session.role, "member.manage_roles");
  const timeZone = resolveTimeZone(null, process.env.DEFAULT_TIMEZONE);
  const members = await listMembers(session.supabase, session.householdId);
  // RLS lets only coordinators read invitations, and never the token hash.
  const { data: invitations } = coordinator
    ? await session.supabase
        .from("invitations")
        .select("id, role, invited_email, status, expires_at, created_at")
        .eq("household_id", session.householdId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <>
      <h1 className="text-4xl font-bold">{t.settings.title}</h1>
      <p className="mt-2 text-lg text-ink-soft">{session.householdName}</p>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-2">
        <section aria-labelledby="members-title" className="paper-card p-4 sm:p-6">
          <h2 id="members-title" className="text-2xl font-semibold">
            {t.household.membersTitle}
          </h2>
          <ul className="mt-4 grid gap-4">
            {members.map((m) => {
              const role = roleSchema.catch("elder").parse(m.role);
              return (
                <li key={m.id} className="border-b border-line pb-4 last:border-b-0">
                  <p className="text-lg font-semibold">
                    {m.display_name}
                    {m.id === session.memberId ? (
                      <span className="font-normal text-ink-soft"> ({t.household.you})</span>
                    ) : null}
                  </p>
                  <p className="text-lg text-ink-soft">
                    {t.household.roles[role]}: {t.household.roleHelp[role]}
                  </p>
                  {coordinator ? (
                    <div className="mt-2">
                      <MemberRoleForm memberId={m.id} name={m.display_name} role={role} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!coordinator ? (
            <p className="mt-4 text-lg text-ink-soft">{t.household.onlyCoordinator}</p>
          ) : null}
        </section>

        <div className="grid content-start gap-6">
          {coordinator ? (
            <>
              <InviteForm />
              <section aria-labelledby="pending-title" className="paper-card p-4 sm:p-6">
                <h2 id="pending-title" className="text-2xl font-semibold">
                  {t.household.pendingTitle}
                </h2>
                {(invitations ?? []).length === 0 ? (
                  <p className="mt-3 text-lg">{t.household.pendingNone}</p>
                ) : (
                  <ul className="mt-4 grid gap-4">
                    {(invitations ?? []).map((inv) => {
                      const role = roleSchema.catch("elder").parse(inv.role);
                      const label = `${t.household.roles[role]}${inv.invited_email ? `, ${inv.invited_email}` : ""}`;
                      return (
                        <li
                          key={inv.id as string}
                          className="flex flex-wrap items-center justify-between gap-3"
                        >
                          <p className="text-lg">
                            <strong>{label}</strong>
                            <br />
                            {t.household.expires}:{" "}
                            {formatTimestamp(inv.expires_at as string, timeZone)}
                          </p>
                          <RevokeInvitationButton invitationId={inv.id as string} label={label} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          ) : null}
          <section aria-labelledby="reminders-title" className="paper-card p-4 sm:p-6">
            <h2 id="reminders-title" className="text-2xl font-semibold">
              {t.settings.reminders}
            </h2>
            <p className="mt-2 text-lg">{t.household.remindersSoon}</p>
            <h2 className="mt-6 text-2xl font-semibold">{t.settings.calendar}</h2>
            <p className="mt-2 text-lg">{t.household.calendarSoon}</p>
          </section>
        </div>
      </div>
    </>
  );
}
