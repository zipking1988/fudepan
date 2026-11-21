"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeNextPath } from "@/lib/auth/next-path";
import { errorCode, log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    log("warn", "auth.sign_in_failed", { code: errorCode(error) });
    const rateLimited = error.status === 429;
    return {
      email: parsed.data.email,
      fieldErrors: {},
      formError: rateLimited
        ? "There have been too many sign-in attempts. Wait a few minutes, then try again."
        : "That email address and password don't match an account. Check both and try again. If you forgot your password or don't have an account yet, see “Need help signing in?” below the form.",
    };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
