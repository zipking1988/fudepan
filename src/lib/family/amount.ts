/** Currencies the amount form offers, with how many decimals each one uses. */
export const AMOUNT_DECIMALS = { JPY: 0, USD: 2, EUR: 2 } as const;
export type AmountCurrency = keyof typeof AMOUNT_DECIMALS;
export const AMOUNT_CURRENCIES = Object.keys(AMOUNT_DECIMALS) as AmountCurrency[];

/**
 * Turns "12.50" into 1250 (minor units) without floating point.
 * Null when the text is not a plain non-negative amount with at most the currency's decimals.
 */
export function toMinorUnits(text: string, currency: AmountCurrency): number | null {
  const decimals = AMOUNT_DECIMALS[currency];
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const whole = match[1] ?? "";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const minor = Number(whole + fraction.padEnd(decimals, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}
