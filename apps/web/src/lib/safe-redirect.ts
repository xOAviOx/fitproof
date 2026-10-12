const DEFAULT_PATH = "/dashboard";

/**
 * Accepts only same-site relative paths for post-login redirects, so a crafted
 * `?next=` cannot send users to another origin (open redirect).
 */
export function safeNextPath(value: unknown, fallback: string = DEFAULT_PATH): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
