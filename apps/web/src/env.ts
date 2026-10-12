import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, "must be a postgres:// or postgresql:// connection string"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(3),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "looks too short to be a Supabase key"),
  NEXT_PUBLIC_SITE_URL: z.url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid or missing environment variables:\n${issues}\nSee .env.example.`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Validated on first use and at boot (next.config.ts and instrumentation.ts), so bad config fails fast. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
