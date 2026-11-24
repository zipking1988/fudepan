import type { Metadata } from "next";
import { getDemoAccount } from "@/app/login/demo-account";
import { Landing } from "@/components/landing/landing";
import { COPY, LINKS } from "@/components/landing/content";

export const metadata: Metadata = {
  title: COPY.en.meta.title,
  description: COPY.en.meta.description,
  alternates: { canonical: LINKS.home.en, languages: { ja: LINKS.home.ja, en: LINKS.home.en } },
};

/** The homepage in English. The handwritten note stays in Japanese, with an English transcript. */
export default function HomeEnglish() {
  return <Landing lang="en" demoConfigured={getDemoAccount() !== null} />;
}
