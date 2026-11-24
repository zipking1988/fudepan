import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { safeNextPath } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";
import { isUuid } from "@/lib/ids";

export const metadata: Metadata = {
  title: "Care Chain — Fudepan",
};

/**
 * The old Care Chain page is replaced by the picture-first event page. Old links
 * still work: they open the same note's event (or the care recipient's own view).
 * The note is looked up with the person's own row-level-security client, so a
 * chain from another household is "not found", as before.
 */
export default function CareChainPage({ params }: PageProps<"/care/[chainId]">) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <CareChainRedirect params={params} />
    </Suspense>
  );
}

async function CareChainRedirect({ params }: Pick<PageProps<"/care/[chainId]">, "params">): Promise<null> {
  const { chainId } = await params;
  const { supabase, user } = await getSession();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(`/care/${chainId}`))}`);
  if (!isUuid(chainId)) notFound();
  const { data: chain } = await supabase.from("care_chains").select("note_id").eq("id", chainId).maybeSingle();
  if (!chain) notFound();
  redirect(`/family/events/${chain.note_id}`);
  return null;
}
