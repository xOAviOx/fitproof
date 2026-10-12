import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/env";
import { isProtectedPath } from "@/lib/routes";

/**
 * Refreshes the Supabase session cookie on every matched request and redirects
 * anonymous visitors away from protected pages. Pages still verify the user
 * themselves; this is an early, optimistic check.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = serverEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    },
  );

  // Must run right after creating the client so a refreshed token is written back.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;

  const redirectTo = (path: string, next?: string) => {
    const url = request.nextUrl.clone();
    url.pathname = path;
    url.search = "";
    if (next) url.searchParams.set("next", next);
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  };

  if (!signedIn && isProtectedPath(pathname)) return redirectTo("/login", pathname);
  if (signedIn && pathname === "/login") return redirectTo("/dashboard");
  return response;
}
