import "../app.css";
import { appFontClasses } from "../app-fonts";
import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Fudepan" };

/**
 * Shell for sign-up, household creation, and invite pages. It reads no session or language, so it
 * stays static; each page reads what it needs behind its own Suspense boundary.
 */
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`app-shell ${appFontClasses}`} data-buttons="arrow">
      <header className="app-header">
        <Link href="/" className="app-wordmark">
          Fudepan
        </Link>
      </header>
      <main id="main" className="app-main app-main--narrow">
        {children}
      </main>
    </div>
  );
}
