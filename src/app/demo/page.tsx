import "../app.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import { appFontClasses } from "../app-fonts";
import { DemoBoard } from "./demo-board";

export const metadata: Metadata = {
  title: "Fudepan demo",
  description: "Try how one handwritten note becomes shared care, with a made-up family. Nothing is saved.",
};

/** Public, sign-in free demo. Fictional data, kept in the browser only. The shell is static. */
export default function DemoPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  return (
    <main className={`demo-shell ${appFontClasses}`}>
      <Suspense
        fallback={
          <p role="status" aria-live="polite">
            <span lang="ja">デモを準備しています…</span> <span lang="en">Getting the demo ready…</span>
          </p>
        }
      >
        <LocalizedDemo searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** Reads ?lang= at request time. Only "ja" or "en" is accepted; anything else keeps the Japanese default. */
async function LocalizedDemo({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang } = await searchParams;
  return <DemoBoard initialLanguage={lang === "en" ? "en" : "ja"} />;
}
