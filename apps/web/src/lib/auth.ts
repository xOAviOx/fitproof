import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { serverEnv } from "@/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CurrentUser = { id: string; email: string | null };

/** Verified identity from the session JWT (signature checked by Supabase), deduped per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Sign-in emails are verified (magic link or Google), so the email claim is safe to match on. */
export function isAdmin(user: CurrentUser | null): boolean {
  const email = user?.email?.toLowerCase();
  return Boolean(email && serverEnv().ADMIN_EMAILS.includes(email));
}

/** Everyone else gets a plain 404, so the page's existence isn't advertised. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdmin(user)) notFound();
  return user;
}
