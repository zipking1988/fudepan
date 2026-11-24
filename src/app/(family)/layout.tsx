import "../app.css";
import "./family.css";
import "./playful.css";
import { appFontClasses } from "../app-fonts";
import { landingFontClasses } from "@/components/landing/landing-fonts";
import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { FamilyHeader } from "./family-chrome";
import { SessionFamilyHeader } from "./family-header";
import { FamilyMain } from "./family-chrome";
export const metadata: Metadata = { title: "Fudepan" };
/**
 * Family shell. The layout reads no session itself; the header (which needs the
 * member's role and language) reads it behind its own Suspense boundary.
 * `fb-shell` gives every family page the landing's warm header and type.
 */
export default function FamilyLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`app-shell fb-shell pb-shell ${appFontClasses} ${landingFontClasses}`}>
      <Suspense fallback={<FamilyHeader role={null} language="en" />}>
        <SessionFamilyHeader />
      </Suspense>
      <FamilyMain>{children}</FamilyMain>
    </div>
  );
}
