import "../app.css";
import { appFontClasses } from "../app-fonts";

import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "../login/actions";

/**
 * Signed-in app shell. It reads no session itself, so it stays in the static
 * shell; each page checks the session and household behind its own boundary.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`app-shell ${appFontClasses}`} data-buttons="arrow">
      <a href="#main" className="app-skip">
        Skip to main content
      </a>
      <header className="app-header">
        <Link href="/notes" className="app-wordmark">
          Fudepan
        </Link>
        <nav aria-label="Main" className="app-nav">
          <Link href="/notes">Notes</Link>
        </nav>
        <form action={signOut}>
          <button type="submit" className="app-button app-button--quiet">
            Sign out
          </button>
        </form>
      </header>
      <main id="main" tabIndex={-1} className="app-main">
        {children}
      </main>
    </div>
  );
}
