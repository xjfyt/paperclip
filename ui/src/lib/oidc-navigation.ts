/** Only server-issued web destinations are navigable; never execute script/data URLs. */
export function oidcNavigationUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return url.href;
  } catch { /* Invalid response. */ }
  return null;
}
export function safeOidcReturnPath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !/[\\\r\n]/.test(value) ? value : "/";
}
