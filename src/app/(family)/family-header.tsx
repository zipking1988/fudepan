import { getFamilyContext, getRequestLanguage } from "@/lib/family/session";
import { firstName } from "@/lib/family/names";
import { portraitUrl } from "@/lib/portraits/service";
import { FamilyHeader } from "./family-chrome";

/** Reads the session, so it must render inside <Suspense>. */
export async function SessionFamilyHeader() {
  const { supabase, user, result } = await getFamilyContext();
  if (!user || !result || result.kind !== "ok") return <FamilyHeader role={null} language={await getRequestLanguage()} />;
  const { context } = result;
  // Unseen in-app reminders addressed to this member. A failed count only hides the number.
  const [{ count }, { data: own }] = await Promise.all([
    supabase
      .from("feed_items")
      .select("id", { count: "exact", head: true })
      .eq("household_id", context.householdId)
      .eq("recipient_member_id", context.memberId)
      .is("seen_at", null),
    // The member's own private portrait, when they added one. A failed read only shows initials.
    supabase.from("member_portraits").select("updated_at").eq("member_id", context.memberId).maybeSingle(),
  ]);
  return <FamilyHeader
      role={context.role}
      language={context.language}
      unseenReminders={count ?? 0}
      who={{ name: firstName(context.displayName) || context.displayName, memberId: context.memberId, householdId: context.householdId, portraitSrc: portraitUrl(context.memberId, own?.updated_at) }}
    />;
}
