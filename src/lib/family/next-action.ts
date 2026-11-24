/**
 * The one next step to promote in task detail, taken from what the viewer is already offered.
 * Pure: it never grants anything. The buttons still call the same permission-checked actions.
 */
import type { PartOffers } from "./event-offers";
export type NextAction =
  | { kind: "claim" }
  | { kind: "confirm" }
  | { kind: "complete" }
  | { kind: "details" }
  | { kind: "waitingOwner" }
  | { kind: "none" };
export function nextAction(input: {
  offers: Pick<PartOffers, "claim" | "approve" | "complete">;
  closed: boolean;
  canWrite: boolean;
  hasQuestion: boolean;
  ownedByOther: boolean;
}): NextAction {
  if (input.closed || !input.canWrite) return { kind: "none" };
  if (input.offers.approve) return { kind: "confirm" };
  if (input.offers.complete) return { kind: "complete" };
  if (input.hasQuestion) return { kind: "details" };
  if (input.offers.claim.length > 0) return { kind: "claim" };
  if (input.ownedByOther) return { kind: "waitingOwner" };
  return { kind: "none" };
}
