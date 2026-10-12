/** Paths that require a signed-in user. The proxy redirects anonymous visitors to /login. */
export const PROTECTED_PREFIXES = [
  "/dashboard",
  "/profile",
  "/preferences",
  "/jobs",
  "/tracker",
  "/settings",
  "/admin",
] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
