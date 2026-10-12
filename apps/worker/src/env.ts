import { z } from "zod";

const workerEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/.+/, "must be a postgres:// or postgresql:// connection string"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseWorkerEnv(source: Record<string, string | undefined>): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid or missing environment variables:\n${issues}\nSee .env.example.`);
  }
  return result.data;
}
