import { Geist, Zen_Kurenaido } from "next/font/google";

/**
 * next/font self-hosts these: the files are downloaded once at build time and served from this app,
 * so visitors never contact Google. Only the CSS variables are set on <html>; each page decides
 * whether to use them.
 */
export const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

/** Grandma's handwriting. Japanese glyphs load on demand by unicode range, so no preload. */
export const handJa = Zen_Kurenaido({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-zen-kurenaido",
});

export const fontVariables = `${geist.variable} ${handJa.variable}`;
