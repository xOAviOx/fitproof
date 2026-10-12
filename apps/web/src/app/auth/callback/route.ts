import { type NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Completes OAuth and PKCE magic-link sign-in by exchanging the one-time code for a session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    logger.warn({ status: error.status, code: error.code }, "auth code exchange failed");
  }
  return NextResponse.redirect(new URL("/auth/error?reason=callback", origin));
}
