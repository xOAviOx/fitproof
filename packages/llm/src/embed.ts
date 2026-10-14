import { EMBEDDING_DIMENSIONS } from "@repo/core";
import type { Database } from "@repo/db";
import { embedMany } from "ai";
import { consumeBudget, embeddingModelId, type LlmEnv, providerFor } from "./provider";

export interface Embedder {
  /** Stored with each vector; vectors from different models are never compared. */
  readonly model: string;
  embed(values: string[]): Promise<number[][]>;
}
export type EmbedFunction = (values: string[]) => Promise<number[][]>;

export function createEmbedder(db: Database, env: LlmEnv, embed?: EmbedFunction): Embedder {
  const modelId = embeddingModelId(env);
  const call: EmbedFunction =
    embed ??
    (async (values) => {
      const result = await embedMany({
        model: providerFor(env).embeddingModel(modelId),
        values,
        dimensions: EMBEDDING_DIMENSIONS,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(30_000),
        providerOptions: env.LLM_PROVIDER === "gemini" ? { google: { taskType: "SEMANTIC_SIMILARITY" } } : {},
      });
      return result.embeddings;
    });
  return {
    model: `${env.LLM_PROVIDER}:${modelId}:${EMBEDDING_DIMENSIONS}`,
    async embed(values) {
      await consumeBudget(db, env, "embed", { maxWaitSeconds: 30 });
      const vectors = await call(values.map((value) => value.slice(0, 8000)));
      if (
        vectors.length !== values.length ||
        vectors.some((vector) => vector.length !== EMBEDDING_DIMENSIONS)
      ) {
        throw new Error("Embedding provider returned unexpected dimensions");
      }
      return vectors;
    },
  };
}
