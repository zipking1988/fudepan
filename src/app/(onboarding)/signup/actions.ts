"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/next-path";
import type { MessageKey } from "@/lib/i18n/messages";
import { errorCode, log } from "@/lib/log";
import { hasInviteCookie } from "@/lib/membership/invite-cookie";
import { postAuthDestination } from "@/lib/membership/routing";
import { signUpInput, validateForm } from "@/lib/membership/schemas";
import { createClient } from "@/lib/supabase/server";

export type SignUpState = {
  /** The entered email. The password is never sent back. */
  email: string;
  fieldKeys: Record<string, MessageKey>;
  /** "check_email" is a success notice; "error" shows `messageKey` in an alert. */
  result: "check_email" | "error" | null;
  messageKey: MessageKey | null;
};

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signUp(_previous: SignUpState, formData: FormData): Promise<SignUpState> {
  const text = (name: string) => (typeof formData.get(name) === "string" ? String(formData.get(name)) : "");
  const rawNext = text("next");
  const validated = validateForm(signUpInput, { email: text("email"), password: text("password") });
  if (!validated.ok) {
    return {
      email: validated.values.email ?? "",
      fieldKeys: validated.fieldKeys,
      result: null,
      messageKey: null,
    };
  }

  const next = safeNextPath(rawNext);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: validated.data.email,
    password: validated.data.password,
    options: { emailRedirectTo: `${await requestOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    log("warn", "membership.sign_up_failed", { code: errorCode(error) });
    const limited = error.status === 429 || error.code === "over_email_send_rate_limit";
    return {
      email: validated.data.email,
      fieldKeys: {},
      result: "error",
      messageKey: limited ? "signup.error.rateLimited" : "signup.error.failed",
    };
  }
  if (data.session) {
    redirect(
      postAuthDestination({
        activeRole: null,
        hasInviteCookie: await hasInviteCookie(),
        requestedNext: next,
      }),
    );
  }
  // A null session and an obfuscated existing address look the same on purpose.
  return { email: validated.data.email, fieldKeys: {}, result: "check_email", messageKey: "signup.checkEmail" };
}
