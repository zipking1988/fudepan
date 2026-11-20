import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { fontVariables } from "@/app/fonts";
import { SiteHeader } from "@/components/SiteHeader";
import { t } from "@/lib/i18n/messages";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: t.appName, template: `%s | ${t.appName}` },
  description: t.tagline,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f2eb" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {/* Marks that JavaScript runs, before first paint, so motion layouts can start in place. */}
        <script
          dangerouslySetInnerHTML={{ __html: 'document.documentElement.classList.add("js")' }}
        />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-paper focus:px-4 focus:py-3 focus:text-sumi"
        >
          {t.skipToContent}
        </a>
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
          {children}
        </main>
        <footer className="border-t border-line bg-paper">
          <p className="mx-auto max-w-6xl px-4 py-6 text-lg text-ink-soft sm:px-6">{t.footer}</p>
        </footer>
      </body>
    </html>
  );
}
