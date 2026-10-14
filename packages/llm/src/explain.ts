import {
  EXPLANATION_PROMPT_VERSION,
  EXPLANATION_SYSTEM,
  type ExplanationOutput,
  explanationOutputSchema,
  SCORING_CONFIG,
  type VerifiedExplanation,
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

export type ExplanationResult = {
  /** Null when both attempts failed verification: show the structured overlap without prose. */
  output: ExplanationOutput | null;
  verified: VerifiedExplanation | null;
  /** Quote-validity rate of each attempt, for the metric. */
  validityRates: number[];
  cached: boolean;
  inputTokens: number;
  outputTokens: number;
};
export interface MatchExplainer {
  explain(input: {
    userId: string;
    prompt: string;
    verify: (output: ExplanationOutput) => VerifiedExplanation;
  }): Promise<ExplanationResult>;
}

export function createMatchExplainer(
  db: Database,
  env: LlmEnv,
  generate: ObjectGenerator = providerGenerator(env),
): MatchExplainer {
  const acceptable = (verified: VerifiedExplanation) =>
    1 - verified.validityRate <= SCORING_CONFIG.explanations.maxQuoteFailureRate;
  return {
    async explain({ userId, prompt, verify }) {
      if (prompt.length > 40_000) throw new Error("LLM input exceeds the token budget");
      const key = hashKey([userId, env.LLM_PROVIDER, env.LLM_MODEL, EXPLANATION_PROMPT_VERSION, prompt]);
      const cached = await readCache(db, key, userId);
      const parsedCache = cached ? explanationOutputSchema.safeParse(cached.response) : null;
      if (parsedCache?.success) {
        const verified = verify(parsedCache.data);
        if (acceptable(verified)) {
          return {
            output: parsedCache.data,
            verified,
            validityRates: [verified.validityRate],
            cached: true,
            inputTokens: 0,
            outputTokens: 0,
          };
        }
      }
      const validityRates: number[] = [];
      let inputTokens = 0;
      let outputTokens = 0;
      // Verification failing on more than the allowed share of quotes triggers one regeneration.
      for (let attempt = 0; attempt < 2; attempt++) {
        await consumeBudget(db, env, "generate", { maxWaitSeconds: 60 });
        const result = await generate({
          system: EXPLANATION_SYSTEM,
          prompt,
          schema: explanationOutputSchema,
          maxOutputTokens: 6000,
        });
        inputTokens += result.inputTokens;
        outputTokens += result.outputTokens;
        const output = explanationOutputSchema.parse(result.object);
        const verified = verify(output);
        validityRates.push(verified.validityRate);
        if (acceptable(verified)) {
          await writeCache(db, {
            key,
            model: env.LLM_MODEL,
            purpose: EXPLANATION_PROMPT_VERSION,
            userId,
            response: output,
            inputTokens,
            outputTokens,
            ttlDays: 30,
          });
          return { output, verified, validityRates, cached: false, inputTokens, outputTokens };
        }
      }
      return { output: null, verified: null, validityRates, cached: false, inputTokens, outputTokens };
    },
  };
}
