/** Shared Tailwind class names. Tap targets are at least 48px; focus rings come from globals.css. */
export const buttonBase =
  "inline-flex min-h-12 min-w-12 items-center justify-center rounded-md px-6 py-3 text-lg font-semibold disabled:cursor-not-allowed disabled:bg-ink-soft disabled:text-white";
export const primaryButton = `${buttonBase} bg-sage-800 text-white hover:bg-sage-900`;
export const secondaryButton = `${buttonBase} border-2 border-sage-800 bg-paper text-sage-800 hover:bg-sage-100 disabled:border-ink-soft disabled:bg-paper-shade disabled:text-ink-soft`;
export const dangerButton = `${buttonBase} border-2 border-danger bg-paper text-danger hover:bg-danger-50`;
export const fieldClass =
  "mt-2 block min-h-12 w-full rounded-md border-2 border-edge bg-paper p-3 text-lg text-ink";
export const cardClass = "paper-card p-4 sm:p-6";
export const linkClass =
  "font-semibold text-sage-800 underline underline-offset-4 hover:bg-sage-100 rounded";
