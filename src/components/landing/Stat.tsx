import { STATS, type StatKey } from "@/lib/demo/landing";

/** One sourced number. The source opens the primary publication. */
export function Stat({ id, tone = "light" }: { id: StatKey; tone?: "light" | "dark" }) {
  const s = STATS[id];
  return (
    <figure className="lp-stat" data-tone={tone} data-evidence-item>
      <p className="lp-stat-figure">{s.figure}</p>
      <figcaption>
        <p className="lp-stat-text">{s.text}</p>
        <p className="lp-stat-source">
          <a href={s.href} rel="noopener noreferrer" target="_blank">
            {s.source}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </figcaption>
    </figure>
  );
}
