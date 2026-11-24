/** Pure rules for a care recipient's portrait. No I/O. */
import { sniffNoteImageType } from "@/lib/notes/validation";
export const PORTRAIT_BUCKET = "member-portraits";
export const MAX_PORTRAIT_BYTES = 2 * 1024 * 1024;
export const PORTRAIT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type PortraitType = (typeof PORTRAIT_TYPES)[number];
export const PORTRAIT_EXT: Record<PortraitType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export type PortraitCheck =
  | { ok: true; contentType: PortraitType }
  | { ok: false; code: "no_file" | "empty" | "too_large" | "unsupported_type" };
/** The bytes decide the type, not the file name or the declared MIME type. */
export function checkPortrait(bytes: Uint8Array | null): PortraitCheck {
  if (!bytes) return { ok: false, code: "no_file" };
  if (bytes.byteLength === 0) return { ok: false, code: "empty" };
  if (bytes.byteLength > MAX_PORTRAIT_BYTES) return { ok: false, code: "too_large" };
  const type = sniffNoteImageType(bytes.subarray(0, 32));
  return type ? { ok: true, contentType: type } : { ok: false, code: "unsupported_type" };
}
export function buildPortraitPath(householdId: string, memberId: string, nowMs: number, type: PortraitType): string {
  return `${householdId}/${memberId}/${String(nowMs).padStart(13, "0")}-portrait.${PORTRAIT_EXT[type]}`;
}
export function isPortraitPathFor(path: string, householdId: string, memberId: string): boolean {
  return path.startsWith(`${householdId}/${memberId}/`) && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/\d{13}-portrait\.(jpg|png|webp)$/.test(path);
}
/**
 * Who may add or change a portrait: an active member for their own card, or an active primary
 * caregiver for a care recipient's card. Same household is checked by the caller (resolve()).
 */
export function mayWritePortrait(
  actor: { id?: string; role: string; isActive: boolean },
  target: { id?: string; role: string; isActive: boolean },
): boolean {
  if (!actor.isActive || !target.isActive) return false;
  if (actor.id !== undefined && actor.id === target.id) return true;
  return actor.role === "primary_caregiver" && target.role === "care_recipient";
}
