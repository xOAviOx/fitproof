import { z } from "zod";

const serverEnvSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/.+/, "must be a postgres:// or postgresql:// connection string"),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(3),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "looks too short to be a Supabase key"),
    NEXT_PUBLIC_SITE_URL: z.url(),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    RESUME_UPLOADS_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SUPABASE_SECRET_KEY: z.string().min(20).optional(),
    RESUME_STORAGE_BUCKET: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .default("resumes"),
  })
  .superRefine((env, ctx) => {
    if (env.RESUME_UPLOADS_ENABLED && !env.SUPABASE_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["SUPABASE_SECRET_KEY"],
        message: "Required when résumé uploads are enabled",
      });
    }
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
