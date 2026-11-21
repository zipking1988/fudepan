import { RISK_LABELS, type RiskLevel } from "@/lib/care/risk";

/** Risk as words plus a shape, never color alone (accessibility steering). */
export function RiskLabel({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`risk risk--${risk}`}>
      <span aria-hidden="true" className="risk__glyph">
        {risk === "high" ? "!" : risk === "medium" ? "?" : "✓"}
      </span>
      {RISK_LABELS[risk]}
    </span>
  );
}

/** First letter avatar for a fictional family member. */
export function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className={`avatar avatar--${name.toLowerCase()}`}>
      {name.charAt(0)}
    </span>
  );
}

export function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="icon">
      <path
        d="M4.5 10.5l3.5 3.5 7.5-8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Cross() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="icon">
      <path
        d="M6 6l8 8M14 6l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="icon">
      <path
        d="M4 10h11M11 5.5L15.5 10 11 14.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
