/**
 * Sign-in help, written to match how accounts really work today:
 *
 * - Public sign-up is off (`enable_signup = false` in supabase/config.toml).
 * - There is no invitation email, invite code, or accept-invite page.
 * - There is no password reset page, and Fudepan sends no recovery email.
 * - Accounts and password resets are done by hand, by whoever manages
 *   Fudepan for the household, when the household organizer asks.
 *
 * Update this text when a real invite or reset flow exists, and link to it.
 */
export const SIGN_IN_HELP = {
  title: "Need help signing in?",
  noAccount: {
    title: "No account yet",
    steps: [
      "Fudepan doesn’t have sign-up or email invitations yet, so there is no invite code to look for.",
      "Ask the person who organizes care in your household to request an account for you. Give them the email address you want to use.",
      "When the account is ready, they’ll tell you the password. Sign in with that email and password here.",
    ],
  },
  forgotPassword: {
    title: "Forgot your password",
    steps: [
      "Fudepan can’t send a reset link yet.",
      "Ask your household organizer to have your password reset. They’ll arrange it with whoever manages Fudepan for your household and tell you the new password.",
      "Ask them to tell you in person or by phone, not in a group chat.",
    ],
  },
} as const;
