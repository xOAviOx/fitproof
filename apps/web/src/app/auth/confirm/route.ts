import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const otpTypeSchema = z.enum(["email", "magiclink", "signup", "invite", "email_change"]);

/**
 * Token-hash magic links (see README: email template). Unlike the PKCE code flow,
 * these work even when the link is opened in a different browser than the one that requested it.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = otpTypeSchema.safeParse(searchParams.get("type"));
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type.success) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, origin));
    logger.warn({ status: error.status, code: error.code }, "magic link verification failed");
  }
  return NextResponse.redirect(new URL("/auth/error?reason=link", origin));
}
