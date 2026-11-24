import "./brand.css";
import Link from "next/link";
import type { Language } from "@/lib/i18n/format";
import { LINKS } from "./content";
import { BrushTicks } from "./icons";

/**
 * The Fudepan wordmark with its brush ticks. The one brand implementation for the landing, /login
 * and the signed-in family pages. It links to the public landing page in `lang` (/ for Japanese,
 * /en for English), which is also what FamilyHeader uses. Pass `href` only to override that.
 */
export function Wordmark({ lang, href }: { lang: Language; href?: string }) {
  return (
    <Link href={href ?? LINKS.home[lang]} className="lp-wordmark">
      Fudepan
      <BrushTicks className="lp-wordmark__ticks" />
    </Link>
  );
}
