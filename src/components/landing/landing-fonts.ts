import { BIZ_UDPGothic, Zen_Maru_Gothic } from "next/font/google";

/**
 * Landing-only type. A rounded gothic for headings and buttons, and BIZ UDP
 * Gothic, a Universal Design face made for easy reading, for body text.
 * Google serves the Japanese glyphs in small unicode-range files, so a page
 * downloads only the characters it uses. Nothing is preloaded: the Japanese
 * files are many and small, and the system font shows until they arrive.
 */
const display = Zen_Maru_Gothic({
  variable: "--lp-font-display",
  weight: ["700", "900"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const text = BIZ_UDPGothic({
  variable: "--lp-font-text",
  weight: ["400", "700"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const landingFontClasses = `${display.variable} ${text.variable}`;
