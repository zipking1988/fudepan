import { Suspense } from "react";
import { getSession } from "@/lib/auth/session";
import { getRequestLanguage } from "@/lib/family/session";
import { createTranslator } from "@/lib/i18n/messages";
import { hasInviteCookie } from "@/lib/membership/invite-cookie";
import { JoinClient } from "./join-client";

export default function JoinPage() {
  return (
    <Suspense fallback={<p role="status">…</p>}>
      <Join />
    </Suspense>
  );
}

/** Works from the address fragment on the first visit and from the cookie after sign-in. */
async function Join() {
  const [{ user }, language, hasCookie] = await Promise.all([
    getSession(),
    getRequestLanguage(),
    hasInviteCookie(),
  ]);
  const tr = createTranslator(language);
  return (
    <>
      <h1 className="app-title">{tr.t("join.title")}</h1>
      <JoinClient language={language} signedIn={user !== null} hasCookie={hasCookie} />
    </>
  );
}
