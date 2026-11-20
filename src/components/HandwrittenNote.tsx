/** A paper note with handwriting-style text. Used for typed notes and the fictional example. */
export function HandwrittenNote({
  lines,
  label,
  tilt = false,
}: {
  lines: readonly string[];
  label: string;
  tilt?: boolean;
}) {
  return (
    <figure className={`paper-note px-6 pb-6 pt-8 ${tilt ? "tilt-left" : ""}`}>
      <blockquote
        aria-label={label}
        className="whitespace-pre-wrap font-[family-name:var(--font-hand)] text-2xl leading-[2.1rem] text-ink"
      >
        {lines.join("\n")}
      </blockquote>
    </figure>
  );
}
