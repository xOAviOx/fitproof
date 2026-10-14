import {
  JOB_EXTRACTION_PROMPT_VERSION,
  JOB_EXTRACTION_SYSTEM,
  jobExtractionSchema,
  MAX_JOB_CHARACTERS,
  maskContactDetails,
  verifyJobExtraction,
} from "@repo/core";
import type { Database } from "@repo/db";
import {
  consumeBudget,
  hashKey,
  type LlmEnv,
  type ObjectGenerator,
  providerGenerator,
  readCache,
  writeCache,
} from "./provider";

export type VerifiedJobExtraction = ReturnType<typeof verifyJobExtraction>;
export type JobExtractionResult = {
  extraction: VerifiedJobExtraction;
  /** The exact text the model saw and quotes were verified against. */
  maskedText: string;
  inputTokens: number;
  outputTokens: number;
  cached: boolean;
  attempts: number;
};
export interface JobExtractor {
  extract(input: {
    /** Owner for cache purging; null for shared jobs. */
    userId: string | null;
    text: string;
    hints?: { title?: string | null; company?: string | null };
  }): Promise<JobExtractionResult>;
}

const MIN_VALIDITY = 0.7;

export function createJobExtractor(
  db: Database,
  env: LlmEnv,
  generate: ObjectGenerator = providerGenerator(env),
): JobExtractor {
  return {
    async extract({ userId, text, hints }) {
      if (text.length > MAX_JOB_CHARACTERS) throw new Error("LLM input exceeds the token budget");
      const maskedText = maskContactDetails(text);
      const key = hashKey([
        userId,
        env.LLM_PROVIDER,
        env.LLM_MODEL,
        JOB_EXTRACTION_PROMPT_VERSION,
        maskedText,
      ]);
      const cached = await readCache(db, key, userId);
      const parsedCache = cached ? jobExtractionSchema.safeParse(cached.response) : null;
      if (parsedCache?.success) {
        return {
          extraction: verifyJobExtraction(parsedCache.data, maskedText, hints),
          maskedText,
          inputTokens: 0,
          outputTokens: 0,
          cached: true,
          attempts: 0,
        };
      }
      let inputTokens = 0;
      let outputTokens = 0;
      let best: { raw: unknown; extraction: VerifiedJobExtraction } | null = null;
      let attempts = 0;
      while (attempts < 2) {
        attempts++;
        await consumeBudget(db, env, "generate", { maxWaitSeconds: 60 });
        const result = await generate({
          system: JOB_EXTRACTION_SYSTEM,
          prompt: maskedText,
          schema: jobExtractionSchema,
          maxOutputTokens: 12_000,
        });
        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;
        const raw = jobExtractionSchema.parse(result.object);
        const extraction = verifyJobExtraction(raw, maskedText, hints);
        if (!best || extraction.validityRate > best.extraction.validityRate) best = { raw, extraction };
        if (extraction.validityRate >= MIN_VALIDITY) break;
      }
      if (!best) throw new Error("Job extraction produced no result");
      await writeCache(db, {
        key,
        model: env.LLM_MODEL,
        purpose: JOB_EXTRACTION_PROMPT_VERSION,
        userId,
        response: best.raw,
        inputTokens,
        outputTokens,
        ttlDays: 30,
      });
      return { extraction: best.extraction, maskedText, inputTokens, outputTokens, cached: false, attempts };
    },
  };
}
