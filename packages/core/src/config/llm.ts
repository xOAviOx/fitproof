/**
 * Embedding width is baked into the `vector(n)` columns, so changing it
 * requires a migration and a full re-embed (`worker backfill`).
 * 768 keeps HNSW indexes small and is a supported output size for
 * Gemini's Matryoshka-style embedding model.
 */
export const EMBEDDING_DIMENSIONS = 768;
