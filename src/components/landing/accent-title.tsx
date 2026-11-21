import type { CSSProperties } from "react";

import type { AccentTitle } from "./content";

/**
 * Renders a title with its accent phrase in the serif italic. The accent never
 * breaks across lines. With `words`, every word sits in its own mask so the
 * hero can raise them one by one; the text stays one readable heading.
 */
export function AccentText({ title, words = false }: { title: AccentTitle; words?: boolean }) {
  const at = title.text.indexOf(title.accent);
  if (at < 0) throw new Error(`Accent "${title.accent}" is not in "${title.text}"`);
  const before = title.text.slice(0, at);
  const after = title.text.slice(at + title.accent.length);

  if (!words) {
    return (
      <>
        {before}
        <span className="accent">{title.accent}</span>
        {after}
      </>
    );
  }

  // Units: each plain word, plus the accent phrase as one unit.
  const units: { text: string; accent: boolean }[] = [
    ...split(before).map((text) => ({ text, accent: false })),
    { text: title.accent, accent: true },
    ...split(after).map((text) => ({ text, accent: false })),
  ];
  return (
    <>
      {units.map((unit, i) => (
        <span key={`${i}-${unit.text}`}>
          <span className="word" style={{ "--w": i } as CSSProperties}>
            <span className={`word__inner ${unit.accent ? "accent" : ""}`}>{unit.text}</span>
          </span>
          {i < units.length - 1 && " "}
        </span>
      ))}
    </>
  );
}

function split(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}
