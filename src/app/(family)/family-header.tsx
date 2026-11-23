import { getFamilyContext, getRequestLanguage } from "@/lib/family/session";
import { FamilyHeader } from "./family-chrome";

/** Reads the session, so it must render inside <Suspense>. */
export async function SessionFamilyHeader() {
  const { supabase, user, result } = await getFamilyContext();
  if (!user || !result || result.kind !== "ok") return <FamilyHeader role={null} language={await getRequestLanguage()} />;
  const { context } = result;
  // Unseen in-app reminders addressed to this member. A failed count only hides the number.
  const { count } = await supabase
    .from("feed_items")
    .select("id", { count: "exact", head: true })
    .eq("household_id", context.householdId)
    .eq("recipient_member_id", context.memberId)
    .is("seen_at", null);
  return <FamilyHeader role={context.role} language={context.language} unseenReminders={count ?? 0} />;
}
