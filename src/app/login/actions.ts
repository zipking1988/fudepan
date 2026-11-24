"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { listMemberships } from "@/lib/households/queries";
import { errorCode, log } from "@/lib/log";
import { hasInviteCookie } from "@/lib/membership/invite-cookie";
import { postAuthDestination } from "@/lib/membership/routing";
import { createClient } from "@/lib/supabase/server";
import { getDemoAccount } from "./demo-account";

export type SignInState = {
  email: string;
  fieldErrors: { email?: string; password?: string };
  formError: string | null;
};

const signInInput = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(320, "This email address is too long. Check it and try again.")
    .pipe(z.email("Enter your email address in the form name@example.com.")),
  password: z.string().min(1, "Enter your password.").max(200, "This password is too long."),
});

function formNext(formData: FormData): string | null {
  const rawNext = formData.get("next");
  return typeof rawNext === "string" ? rawNext : null;
}

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const rawEmail = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  const parsed = signInInput.safeParse({
    email: rawEmail,
    password: typeof formData.get("password") === "string" ? formData.get("password") : "",
  });

  if (!parsed.success) {
    const fieldErrors: SignInState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "email" || field === "password") && !fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return { email: rawEmail, fieldErrors, formError: null };
  }

  return completeSignIn(parsed.data, formNext(formData), {
    email: parsed.data.email,
    honorInvite: true,
    mismatch:
      "That email address and password don't match an account. Check both and try again. If you forgot your password, see “Need help signing in?” below the form.",
  });
}

/** One click: signs in with the demo account. The browser never sends the demo password. */
export async function signInAsDemo(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const demo = getDemoAccount();
  if (!demo) {
    return {
      email: "",
      fieldErrors: {},
      formError: "The demo account isn't available right now. Try again later.",
    };
  }
  // A pending invite link is ignored: the shared demo account must never join a real household.
  return completeSignIn(demo, formNext(formData), {
    email: "",
    honorInvite: false,
    mismatch: "The demo account isn't available right now. Try again later.",
  });
}

async function completeSignIn(
  credentials: { email: string; password: string },
  requestedNext: string | null,
  options: { email: string; honorInvite: boolean; mismatch: string },
): Promise<SignInState> {
  const supabase = await createClient();
  const { data: signedIn, error } = await supabase.auth.signInWithPassword(credentials);
  if (error) {
    log("warn", "auth.sign_in_failed", { code: errorCode(error) });
    return {
      email: options.email,
      fieldErrors: {},
      formError:
        error.status === 429
          ? "There have been too many sign-in attempts. Wait a few minutes, then try again."
          : options.mismatch,
    };
  }

  const memberships = signedIn.user
    ? await listMemberships(supabase, signedIn.user.id).catch(() => [])
    : [];
  redirect(
    postAuthDestination({
      activeRole: memberships[0]?.role ?? null,
      hasInviteCookie: options.honorInvite && (await hasInviteCookie()),
      requestedNext,
    }),
  );
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
