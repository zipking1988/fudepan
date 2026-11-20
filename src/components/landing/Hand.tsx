/**
 * Handwriting helpers. Each character gets a tiny, fixed wobble so a font reads like real pen
 * strokes. The wobble is deterministic (seeded by position), so server and client markup match.
 */

const rand = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function HandChars({ text, seed = 0 }: { text: string; seed?: number }) {
  return (
    <>
      {Array.from(text).map((ch, i) => {
        const a = rand(seed * 97 + i);
        const b = rand(seed * 131 + i * 7 + 3);
        return (
          <span
            key={i}
            className="hand-ch"
            style={{
              transform: `translateY(${((b - 0.5) * 2.4).toFixed(2)}px) rotate(${((a - 0.5) * 4).toFixed(2)}deg)`,
            }}
          >
            {ch === " " ? "\u00a0" : ch}
          </span>
        );
      })}
    </>
  );
}
