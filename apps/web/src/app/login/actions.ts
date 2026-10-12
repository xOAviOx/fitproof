"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { serverEnv } from "@/env";
import { logger } from "@/lib/logger";
import { safeNextPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type MagicLinkState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string };

const magicLinkSchema = z.object({ email: z.email().max(254) });

function callbackUrl(next: string): string {
  const url = new URL("/auth/callback", serverEnv().NEXT_PUBLIC_SITE_URL);
  url.searchParams.set("next", next);
  return url.toString();
}

export async function sendMagicLink(_previous: MagicLinkState, formData: FormData): Promise<MagicLinkState> {
  const parsed = magicLinkSchema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: callbackUrl(safeNextPath(formData.get("next"))) },
  });

  if (error) {
    logger.warn({ status: error.status, code: error.code }, "magic link request failed");
    return {
      status: "error",
      message:
        error.status === 429
          ? "Too many sign-in emails were requested. Wait a few minutes and try again."
          : "We couldn't send the sign-in email. Try again, or continue with Google.",
    };
  }
  return { status: "sent", email: parsed.data.email };
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl(safeNextPath(formData.get("next"))) },
  });
  if (error || !data.url) {
    logger.warn({ status: error?.status, code: error?.code }, "google sign-in failed to start");
    redirect("/auth/error?reason=oauth");
  }
  redirect(data.url);
}
