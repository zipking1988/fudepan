/**
 * Refusal codes raised by the Action_Guard (family-shared-care design,
 * "Refusal codes"). Each code maps to a message key, never to English text;
 * the dictionaries (i18n) supply the words later.
 */
export const REFUSAL_MESSAGE_KEYS = {
  // Requirement 14.2: a missing Part and a Part in another household look the same.
  part_not_found: "refusal.notFoundOrNoAccess",
  request_not_found: "refusal.notFoundOrNoAccess",
  recipient_read_only: "refusal.recipientReadOnly",
  // Only the Care_Recipient sends a Recipient_Reply (Requirement 13.10).
  recipient_only: "refusal.recipientOnly",
  not_primary_caregiver: "refusal.notPrimaryCaregiver",
  self_approval_blocked: "refusal.selfApprovalBlocked",
  resubmission_required: "refusal.resubmissionRequired",
  resubmission_empty: "refusal.resubmissionEmpty",
  not_rejected: "refusal.notRejected",
  approval_not_required: "refusal.approvalNotRequired",
  already_claimed: "refusal.alreadyClaimed",
  role_not_offered: "refusal.roleNotOffered",
  release_blocked_due_soon: "refusal.releaseBlockedDueSoon",
  not_holder: "refusal.notHolder",
  receiver_not_eligible: "refusal.receiverNotEligible",
  request_pending: "refusal.requestPending",
  request_not_pending: "refusal.requestNotPending",
  request_expired: "refusal.requestExpired",
  not_owner: "refusal.notOwner",
  approval_pending: "refusal.approvalPending",
  not_failed: "refusal.notFailed",
  not_allowed_reopen: "refusal.notAllowedReopen",
  not_allowed_backup_request: "refusal.notAllowedBackupRequest",
  part_closed: "refusal.partClosed",
  invalid_input: "refusal.invalidInput",
  recognition_running: "refusal.recognitionRunning",
  error: "refusal.error",
} as const;

export type RefusalCode = keyof typeof REFUSAL_MESSAGE_KEYS;

export type RefusalMessageKey = (typeof REFUSAL_MESSAGE_KEYS)[RefusalCode];

export function refusalMessageKey(code: RefusalCode): RefusalMessageKey {
  return REFUSAL_MESSAGE_KEYS[code];
}
