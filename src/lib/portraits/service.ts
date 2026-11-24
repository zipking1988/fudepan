import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/ids";
import type { Database } from "@/lib/supabase/database.types";
import { PORTRAIT_BUCKET, buildPortraitPath, checkPortrait, isPortraitPathFor, mayWritePortrait, type PortraitType } from "./rules";
type Client = SupabaseClient<Database>;
type Member = { id: string; household_id: string; role: string; is_active: boolean };
/**
 * The target member and the caller's own active membership in the same household.
 * Both reads use the caller's row-level-security client, so another household's member is simply absent.
 */
async function resolve(userClient: Client, userId: string, memberId: string) {
  if (!isUuid(memberId)) return null;
  const { data: target, error } = await userClient
    .from("household_members")
    .select("id, household_id, role, is_active")
    .eq("id", memberId)
    .maybeSingle<Member>();
  if (error || !target) return null;
  const { data: actor } = await userClient
    .from("household_members")
    .select("id, household_id, role, is_active")
    .eq("household_id", target.household_id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle<Member>();
  if (!actor) return null;
  return { target, actor };
}
export type SavePortraitResult =
  | { ok: true; updatedAt: string }
  | { ok: false; code: "not_allowed" | "no_file" | "empty" | "too_large" | "unsupported_type" | "failed" };
/** Stores a portrait: an active member for themself, or a same-household primary caregiver for a care recipient. */
export async function savePortrait(args: {
  userClient: Client;
  admin: Client;
  userId: string;
  memberId: string;
  bytes: Uint8Array | null;
  now?: Date;
}): Promise<SavePortraitResult> {
  const found = await resolve(args.userClient, args.userId, args.memberId);
  if (!found || !mayWritePortrait({ id: found.actor.id, role: found.actor.role, isActive: found.actor.is_active }, { id: found.target.id, role: found.target.role, isActive: found.target.is_active })) {
    return { ok: false, code: "not_allowed" };
  }
  const check = checkPortrait(args.bytes);
  if (!check.ok || !args.bytes) return { ok: false, code: check.ok ? "no_file" : check.code };
  const path = buildPortraitPath(found.target.household_id, found.target.id, (args.now ?? new Date()).getTime(), check.contentType as PortraitType);
  const { data: previous } = await args.admin.from("member_portraits").select("object_path").eq("member_id", found.target.id).maybeSingle();
  const up = await args.admin.storage.from(PORTRAIT_BUCKET).upload(path, args.bytes, { contentType: check.contentType, upsert: false });
  if (up.error) return { ok: false, code: "failed" };
  const updatedAt = (args.now ?? new Date()).toISOString();
  const { error } = await args.admin.from("member_portraits").upsert({
    member_id: found.target.id,
    household_id: found.target.household_id,
    object_path: path,
    content_type: check.contentType,
    size_bytes: args.bytes.byteLength,
    updated_by: args.userId,
    updated_at: updatedAt,
  });
  if (error) {
    await args.admin.storage.from(PORTRAIT_BUCKET).remove([path]);
    return { ok: false, code: "failed" };
  }
  if (previous?.object_path && previous.object_path !== path) {
    await args.admin.storage.from(PORTRAIT_BUCKET).remove([previous.object_path]);
  }
  return { ok: true, updatedAt };
}
export type PortraitFile = { body: Blob; contentType: PortraitType };
/** The portrait bytes for any active member of the same household. Null for everyone else. */
export async function openPortrait(args: { userClient: Client; admin: Client; userId: string; memberId: string }): Promise<PortraitFile | null> {
  const found = await resolve(args.userClient, args.userId, args.memberId);
  if (!found) return null;
  // A member who left has no readable portrait.
  if (!found.target.is_active) return null;
  const { data: row } = await args.userClient
    .from("member_portraits")
    .select("object_path, content_type, household_id")
    .eq("member_id", found.target.id)
    .maybeSingle();
  if (!row || row.household_id !== found.target.household_id) return null;
  if (!isPortraitPathFor(row.object_path, found.target.household_id, found.target.id)) return null;
  const { data, error } = await args.admin.storage.from(PORTRAIT_BUCKET).download(row.object_path);
  if (error || !data) return null;
  return { body: data, contentType: row.content_type as PortraitType };
}
/** Member ids of this household that have a portrait, with the time to bust caches. Read with the caller's client. */
export async function portraitVersions(userClient: Client, householdId: string): Promise<Map<string, string>> {
  const [{ data }, { data: active }] = await Promise.all([
    userClient.from("member_portraits").select("member_id, updated_at").eq("household_id", householdId),
    userClient.from("household_members").select("id").eq("household_id", householdId).eq("is_active", true),
  ]);
  const live = new Set((active ?? []).map((m) => m.id));
  return new Map((data ?? []).filter((r) => live.has(r.member_id)).map((r) => [r.member_id, r.updated_at]));
}
/** The private portrait URL of one member, versioned so a new photo shows at once. Null when none. */
export function portraitUrl(memberId: string, version: string | null | undefined): string | null {
  return version ? `/family/members/${memberId}/portrait?v=${encodeURIComponent(version)}` : null;
}
