/**
 * Sign-in help, written to match how accounts really work today:
 *
 * - The sign-in page has no sign-up link. New family members create their
 *   account from the one-time invite link a primary caregiver shares
 *   themselves (the invite page links to sign-up). Fudepan sends no invitation email.
 * - Visitors can look around with the shared demo account when one is set up.
 * - There is no password reset page, and Fudepan sends no recovery email.
 *
 * Update this text when a real reset flow exists, and link to it.
 */
export const SIGN_IN_HELP = {
  title: "Need help signing in?",
  noAccount: {
    title: "No account yet",
    steps: [
      "Ask the person who organizes care in your household for an invite link. Fudepan does not email invitations, so there is no invite code to look for.",
      "Open the link on your phone and follow the steps to make your account. The link works once and stops working after 7 days.",
    ],
  },
  /** Added to "No account yet" only when the demo box is on the page. */
  demoStep: "Just want to look around? Use “Sign in to the demo” above.",
  forgotPassword: {
    title: "Forgot your password",
    steps: [
      "Fudepan can’t send a reset link yet.",
      "Ask your household organizer to have your password reset. They’ll arrange it with whoever manages Fudepan for your household and tell you the new password.",
      "Ask them to tell you in person or by phone, not in a group chat.",
    ],
  },
} as const;
