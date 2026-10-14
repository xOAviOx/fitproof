import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "./client";
import { withUserContext } from "./rls";
import { jobEmbeddings, profileEmbeddings } from "./schema";

/** Embeddings are reused only when both the model and the embedded text are unchanged. */
export async function loadJobEmbedding(db: DbOrTx, jobId: string, model: string, contentHash: string) {
  const [row] = await db
    .select({ embedding: jobEmbeddings.embedding })
    .from(jobEmbeddings)
    .where(
      and(
        eq(jobEmbeddings.jobId, jobId),
        eq(jobEmbeddings.model, model),
        eq(jobEmbeddings.contentHash, contentHash),
      ),
    );
  return row?.embedding ?? null;
}

export async function saveJobEmbedding(
  db: DbOrTx,
  input: { jobId: string; model: string; contentHash: string; embedding: number[] },
) {
  await db
    .insert(jobEmbeddings)
    .values(input)
    .onConflictDoUpdate({
      target: jobEmbeddings.jobId,
      set: {
        model: input.model,
        contentHash: input.contentHash,
        embedding: input.embedding,
        createdAt: new Date(),
      },
    });
}

export async function loadProfileEmbedding(
  db: DbOrTx,
  userId: string,
  input: { profileId: string; kind: string; model: string; contentHash: string },
) {
  return withUserContext(db, userId, async (tx) => {
    const [row] = await tx
      .select({ embedding: profileEmbeddings.embedding })
      .from(profileEmbeddings)
      .where(
        and(
          eq(profileEmbeddings.profileId, input.profileId),
          eq(profileEmbeddings.kind, input.kind),
          eq(profileEmbeddings.model, input.model),
          eq(profileEmbeddings.contentHash, input.contentHash),
        ),
      );
    return row?.embedding ?? null;
  });
}

export async function saveProfileEmbedding(
  db: DbOrTx,
  userId: string,
  input: { profileId: string; kind: string; model: string; contentHash: string; embedding: number[] },
) {
  await withUserContext(db, userId, (tx) =>
    tx
      .insert(profileEmbeddings)
      .values({ userId, ...input })
      .onConflictDoUpdate({
        target: [profileEmbeddings.profileId, profileEmbeddings.kind],
        set: {
          model: input.model,
          contentHash: input.contentHash,
          embedding: input.embedding,
          createdAt: new Date(),
        },
      }),
  );
}
