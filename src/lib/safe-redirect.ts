/** Only allows same-site relative paths, so a sign-in link cannot redirect to another site. */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\"))
    return fallback;
  if (/[\r\n]/.test(value)) return fallback;
  return value;
}
