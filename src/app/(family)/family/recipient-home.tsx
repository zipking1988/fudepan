import { getFamilyFeed } from "@/lib/family/feed";
import { getSharedCareEvent } from "@/lib/care/queries";
import type { FamilyContext } from "@/lib/family/session-core";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import type { getSession } from "@/lib/auth/session";
import { createTranslator } from "@/lib/i18n/messages";
import { PostcardList } from "./playful/postcard";

const RECIPIENT_EVENT_LIMIT = 10;

/** Loads the household's latest events with the viewer's own RLS client. */
export async function RecipientHome({
  context,
  supabase,
}: {
  context: FamilyContext;
  supabase: Awaited<ReturnType<typeof getSession>>["supabase"];
}) {
  const feed = await getFamilyFeed(supabase, context.householdId, context.memberId);
  const ids = feed.events.slice(0, RECIPIENT_EVENT_LIMIT).map((e) => e.noteId);
  const loaded = await Promise.all(ids.map((id) => getSharedCareEvent(supabase, id)));
  const events = loaded.filter(
    (e): e is SharedCareEvent => e !== null && e.householdId === context.householdId,
  );
  return (
    <PostcardList
      events={events}
      language={context.language}
      householdId={context.householdId}
      tr={createTranslator(context.language)}
    />
  );
}
