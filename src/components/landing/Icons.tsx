/* Small line icons (decorative; the text next to each icon carries the meaning). */

type IconProps = { className?: string };
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
};

export const IconAlert = ({ className = "h-[1.05em] w-[1.05em]" }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 3.5 2.8 19.5h18.4z" />
    <path d="M12 10v4.5M12 17.4v.1" />
  </svg>
);
export const IconCheck = ({ className = "h-[1.05em] w-[1.05em]" }: IconProps) => (
  <svg {...base} className={className}>
    <path d="m4.5 12.5 5 5 10-11" />
  </svg>
);
export const IconQuestion = ({ className = "h-[1.05em] w-[1.05em]" }: IconProps) => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4M12 16.8v.1" />
  </svg>
);
export const IconHand = ({ className = "h-[1.05em] w-[1.05em]" }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V10m0-5.5a1.5 1.5 0 0 1 3 0V10m0-4a1.5 1.5 0 0 1 3 0v6.5c0 4-2.5 7-6.5 7-3 0-4.4-1.5-5.8-4l-1.6-2.9a1.5 1.5 0 0 1 2.5-1.6L8 13" />
  </svg>
);
export const IconLock = ({ className = "h-[1.05em] w-[1.05em]" }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);
export const IconArrow = ({ className = "h-[1em] w-[1em]" }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconArrowDown = ({ className = "h-[1em] w-[1em]" }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);
export const IconPlay = ({ className = "h-[1em] w-[1em]" }: IconProps) => (
  <svg {...base} className={className} fill="currentColor" stroke="none">
    <path d="M7 4.8v14.4a1 1 0 0 0 1.5.9l11.3-7.2a1 1 0 0 0 0-1.8L8.5 3.9A1 1 0 0 0 7 4.8z" />
  </svg>
);
export const IconPause = ({ className = "h-[1em] w-[1em]" }: IconProps) => (
  <svg {...base} className={className} fill="currentColor" stroke="none">
    <rect x="6" y="4.5" width="4" height="15" rx="1" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" />
  </svg>
);
export const IconReplay = ({ className = "h-[1em] w-[1em]" }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />
  </svg>
);
