import "server-only";

export type DemoAccount = { email: string; password: string };

/**
 * The shared demo account, from server-only env vars (`DEMO_EMAIL`, `DEMO_PASSWORD`).
 * Null when either is unset, so the login page hides the demo box instead of
 * offering a button that fails. The account must belong only to the fictional
 * demo household (see supabase/seed.sql); its password is shown on the page.
 */
export function getDemoAccount(
  env: Partial<Record<string, string>> = process.env,
): DemoAccount | null {
  const email = env.DEMO_EMAIL?.trim();
  const password = env.DEMO_PASSWORD;
  return email && password ? { email, password } : null;
}
