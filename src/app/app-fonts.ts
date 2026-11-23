import { DM_Mono, Funnel_Display, Funnel_Sans } from "next/font/google";

/**
 * Signed-in app type, dealt by tasteskill 2.5 for a software product
 * (pairing "funnel"). Applied on .app-shell only, so the landing keeps its own.
 */
const display = Funnel_Display({ variable: "--app-font-display", subsets: ["latin"], weight: "variable" });
const text = Funnel_Sans({ variable: "--app-font-text", subsets: ["latin"], weight: "variable" });
const mono = DM_Mono({ variable: "--app-font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const appFontClasses = `${display.variable} ${text.variable} ${mono.variable}`;
