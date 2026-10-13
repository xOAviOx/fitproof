import { llmEnvSchema } from "@repo/llm";
import { z } from "zod";

const storageEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(20),
  RESUME_STORAGE_BUCKET: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default("resumes"),
});

export function parseStorageEnv(source: Record<string, string | undefined>) {
  const parsed = storageEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid storage config: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}. See .env.example.`,
    );
  }
  return parsed.data;
}

export function parseResumeEnv(source: Record<string, string | undefined>) {
  const parsed = llmEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid LLM config: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}. See .env.example.`,
    );
  }
  return { ...parseStorageEnv(source), ...parsed.data };
}
