import type { Metadata } from "next";
import { getDemoAccount } from "@/app/login/demo-account";
import { Landing } from "@/components/landing/landing";
import { COPY, LINKS } from "@/components/landing/content";

export const metadata: Metadata = {
  title: COPY.ja.meta.title,
  description: COPY.ja.meta.description,
  alternates: { canonical: LINKS.home.ja, languages: { ja: LINKS.home.ja, en: LINKS.home.en } },
};

/** The public homepage. Japanese is the default; English is at /en. */
export default function Home() {
  return <Landing lang="ja" demoConfigured={getDemoAccount() !== null} />;
}
