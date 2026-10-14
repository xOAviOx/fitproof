import type { Database } from "@repo/db";
import {
  createEmbedder,
  createJobExtractor,
  createMatchExplainer,
  type LlmEnv,
  llmEnvSchema,
  type ObjectGenerator,
} from "@repo/llm";
import type { AnalysisDeps, AnalysisLogger } from "./analyze";

/** The configured provider, or null when no usable LLM settings are present. */
export function parseOptionalLlmEnv(source: Record<string, string | undefined>): LlmEnv | null {
  const parsed = llmEnvSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
}

/**
 * Model-backed analysis when a provider is configured, otherwise the keyword reader with structured
 * explanations. `generate` swaps the provider call, for tests and the evaluation harness.
 */
export function createAnalysisDeps(
  db: Database,
  env: LlmEnv | null,
  options: { logger?: AnalysisLogger; generate?: ObjectGenerator } = {},
): AnalysisDeps & { mode: "model" | "keywords" } {
  if (!env)
    return { mode: "keywords", extractor: null, explainer: null, embedder: null, logger: options.logger };
  return {
    mode: "model",
    extractor: createJobExtractor(db, env, options.generate),
    explainer: createMatchExplainer(db, env, options.generate),
    embedder: createEmbedder(db, env),
    logger: options.logger,
  };
}
