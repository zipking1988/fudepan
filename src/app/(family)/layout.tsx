import "../app.css";
import { appFontClasses } from "../app-fonts";
import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { FamilyHeader } from "./family-chrome";
import { SessionFamilyHeader } from "./family-header";
import { FamilyMain } from "./family-chrome";

export const metadata: Metadata = { title: "Fudepan" };

/**
 * Family shell. The layout reads no session itself; the header (which needs the
 * member's role and language) reads it behind its own Suspense boundary.
 */
export default function FamilyLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`app-shell ${appFontClasses}`} data-buttons="arrow">
      <Suspense fallback={<FamilyHeader role={null} language="en" />}>
        <SessionFamilyHeader />
      </Suspense>
      <FamilyMain>{children}</FamilyMain>
    </div>
  );
}
