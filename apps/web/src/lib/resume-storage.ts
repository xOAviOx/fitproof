import "server-only";
import { createResumeStorage } from "@repo/storage";
import { serverEnv } from "@/env";

export function getResumeStorage() {
  const env = serverEnv();
  if (!env.RESUME_UPLOADS_ENABLED || !env.SUPABASE_SECRET_KEY) {
    throw new Error("Résumé uploads are not configured");
  }
  return createResumeStorage(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    env.RESUME_STORAGE_BUCKET,
  );
}
