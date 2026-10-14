import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { consumeRateLimit, type Database, RateLimitError, schema } from "@repo/db";
import { generateObject, jsonSchema } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { decoderJsonSchema, fitToSchema, strictJsonSchema } from "./decoder-schema";

const optionalApiKey = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const llmEnvSchema = z
  .object({
    LLM_PROVIDER: z.enum(["gemini", "openai"]).default("gemini"),
    LLM_MODEL: z.string().min(1).default("gemini-2.5-flash"),
    LLM_EMBEDDING_MODEL: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    GEMINI_API_KEY: optionalApiKey,
    OPENAI_API_KEY: optionalApiKey,
    LLM_RPM: z.coerce.number().int().min(1).max(100).default(5),
    LLM_DAILY_REQUESTS: z.coerce.number().int().min(1).max(10000).default(100),
  })
  .superRefine((env, ctx) => {
    const key = env.LLM_PROVIDER === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    if (!env[key])
      ctx.addIssue({ code: "custom", path: [key], message: "Required for the selected LLM provider" });
    if (env.LLM_PROVIDER === "openai" && env.LLM_MODEL.startsWith("gemini")) {
      ctx.addIssue({
        code: "custom",
        path: ["LLM_MODEL"],
        message: "Set an OpenAI model when using the openai provider",
      });
    }
  });
export type LlmEnv = z.infer<typeof llmEnvSchema>;

export function providerFor(env: LlmEnv) {
  return env.LLM_PROVIDER === "gemini"
    ? createGoogleGenerativeAI({ apiKey: env.GEMINI_API_KEY })
    : createOpenAI({ apiKey: env.OPENAI_API_KEY });
}

export const embeddingModelId = (env: LlmEnv) =>
  env.LLM_EMBEDDING_MODEL ??
  (env.LLM_PROVIDER === "gemini" ? "gemini-embedding-001" : "text-embedding-3-small");

export type ObjectRequest = {
  system: string;
  prompt: string;
  schema: z.ZodType;
  maxOutputTokens: number;
};
/** Swappable for tests and the local e2e harness; the default calls the configured provider. */
export type ObjectGenerator = (request: ObjectRequest) => Promise<{
  object: unknown;
  inputTokens: number;
  outputTokens: number;
}>;

export function providerGenerator(env: LlmEnv): ObjectGenerator {
  const model = providerFor(env)(env.LLM_MODEL);
  return async (request) => {
    const strict = strictJsonSchema(request.schema);
    const result = await generateObject({
      model,
      schema: jsonSchema(decoderJsonSchema(strict)),
      system: request.system,
      prompt: request.prompt,
      maxOutputTokens: request.maxOutputTokens,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(90_000),
    });
    return {
      object: request.schema.parse(fitToSchema(result.object, strict)),
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
  };
}

/**
 * Shared per-model quotas across web and worker. A short per-minute wait is absorbed here
 * (backoff); a spent daily quota throws `RateLimitError` so the caller can defer the work.
 */
export async function consumeBudget(
  db: Database,
  env: LlmEnv,
  scope: "generate" | "embed",
  options: { maxWaitSeconds?: number } = {},
) {
  const model = scope === "embed" ? embeddingModelId(env) : env.LLM_MODEL;
  const prefix = `llm:${env.LLM_PROVIDER}:${model}${scope === "embed" ? ":embed" : ""}`;
  for (let attempt = 0; ; attempt++) {
    try {
      await consumeRateLimit(db, `${prefix}:minute`, env.LLM_RPM, 60);
      break;
    } catch (error) {
      const wait = error instanceof RateLimitError ? error.retryAfterSeconds : Number.POSITIVE_INFINITY;
      if (attempt > 0 || wait > (options.maxWaitSeconds ?? 0)) throw error;
      await sleep(wait * 1000);
    }
  }
  await consumeRateLimit(db, `${prefix}:day`, env.LLM_DAILY_REQUESTS, 86400);
}

export const hashKey = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export async function readCache(db: Database, key: string, userId: string | null) {
  const [cached] = await db
    .select()
    .from(schema.llmCache)
    .where(
      userId === null
        ? eq(schema.llmCache.key, key)
        : and(eq(schema.llmCache.key, key), eq(schema.llmCache.userId, userId)),
    )
    .limit(1);
  return cached && (!cached.expiresAt || cached.expiresAt > new Date()) ? cached : null;
}

export async function writeCache(
  db: Database,
  input: {
    key: string;
    model: string;
    purpose: string;
    userId: string | null;
    response: unknown;
    inputTokens: number;
    outputTokens: number;
    ttlDays: number;
  },
) {
  const expiresAt = new Date(Date.now() + input.ttlDays * 86400_000);
  const values = {
    response: input.response,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    expiresAt,
  };
  await db
    .insert(schema.llmCache)
    .values({ key: input.key, model: input.model, purpose: input.purpose, userId: input.userId, ...values })
    .onConflictDoUpdate({ target: schema.llmCache.key, set: values });
}
