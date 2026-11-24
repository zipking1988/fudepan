import type { ReactNode, SVGProps } from "react";

/** Line icons for the landing. Always decorative: the text next to them carries the meaning. */
function Icon({ children, className, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `lp-icon ${className}` : "lp-icon"}
      {...rest}
    >
      {children}
    </svg>
  );
}

type P = { className?: string };

/** The three short brush strokes beside the wordmark. */
export function BrushTicks({ className }: P) {
  return (
    <svg viewBox="0 0 24 20" aria-hidden="true" focusable="false" className={className}>
      <path d="M5 13 2 6M11 10l1.5-8M16 13l6-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
    </svg>
  );
}

export const Camera = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.4" />
  </Icon>
);

export const Calendar = ({ className }: P) => (
  <Icon className={className}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4M8 14h2" />
  </Icon>
);

export const IdCard = ({ className }: P) => (
  <Icon className={className}>
    <rect x="2.5" y="5" width="19" height="14" rx="2" />
    <circle cx="8" cy="11" r="2" />
    <path d="M5 16c.6-1.6 1.7-2.3 3-2.3s2.4.7 3 2.3M14 10h4.5M14 13.5h4.5" />
  </Icon>
);

export const Clinic = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4 21V8l8-4 8 4v13M2.5 21h19" />
    <path d="M12 8.5v5M9.5 11h5M9.5 21v-4h5v4" />
  </Icon>
);

export const Glasses = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="6.5" cy="14" r="3.8" />
    <circle cx="17.5" cy="14" r="3.8" />
    <path d="M10.3 13.4c1.1-.8 2.3-.8 3.4 0M2.7 13.2 4 8.5M21.3 13.2 20 8.5" />
  </Icon>
);

export const Check = ({ className }: P) => (
  <Icon className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const DropIn = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 3v11M7.5 9.5 12 14l4.5-4.5M4 15v4h16v-4" />
  </Icon>
);

export const Heart = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z" />
  </Icon>
);

export const Crown = ({ className }: P) => (
  <Icon className={className}>
    <path d="m3.5 8 4.2 3.6L12 5l4.3 6.6L20.5 8 19 18H5L3.5 8Z" />
  </Icon>
);

export const Car = ({ className }: P) => (
  <Icon className={className}>
    <path d="M4 16v-3.5l2-5h12l2 5V16M3 16h18v2.5H3zM4 12.5h16" />
    <circle cx="7.5" cy="16" r="1.2" />
    <circle cx="16.5" cy="16" r="1.2" />
  </Icon>
);

export const ArrowDown = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 4v15M6 13l6 6 6-6" />
  </Icon>
);

export const Chevron = ({ className }: P) => (
  <Icon className={className}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);

export const Question = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 17.2v.1" />
  </Icon>
);

export const Hourglass = ({ className }: P) => (
  <Icon className={className}>
    <path d="M7 3h10M7 21h10M8 3v3.5L12 12l4-5.5V3M8 21v-3.5l4-5.5 4 5.5V21" />
  </Icon>
);

export const Shield = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 3 5 6v5.5c0 4.4 3 7.9 7 9.5 4-1.6 7-5.1 7-9.5V6l-7-3Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Icon>
);

export const Undo = ({ className }: P) => (
  <Icon className={className}>
    <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const Globe = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" />
  </Icon>
);

/** A filled four-point star, for the short accent around Grandma's photo when a task is done. */
export const Sparkle = ({ className }: P) => (
  <Icon className={className} fill="currentColor" stroke="none">
    <path d="M12 2c.8 5.6 4.4 9.2 10 10-5.6.8-9.2 4.4-10 10-.8-5.6-4.4-9.2-10-10 5.6-.8 9.2-4.4 10-10Z" />
  </Icon>
);

/** Risk marks: each level has its own shape, so risk never depends on color alone. */
export const RiskHigh = ({ className }: P) => (
  <Icon className={className}>
    <path d="M12 3.5 2.5 20h19L12 3.5Z" />
    <path d="M12 10v4.5M12 17.3v.1" />
  </Icon>
);

export const RiskMedium = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.3v.1" />
  </Icon>
);

export const RiskLow = ({ className }: P) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12h8" />
  </Icon>
);
