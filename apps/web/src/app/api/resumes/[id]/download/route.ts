import { schema, withUserContext } from "@repo/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getResumeStorage } from "@/lib/resume-storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401, headers });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found" }, { status: 404, headers });
  const [file] = await withUserContext(getDb(), user.id, (tx) =>
    tx
      .select({ storagePath: schema.resumeFiles.storagePath })
      .from(schema.resumeFiles)
      .where(eq(schema.resumeFiles.id, id))
      .limit(1),
  );
  if (!file) return Response.json({ error: "Not found" }, { status: 404, headers });
  try {
    const url = await getResumeStorage().signedUrl(file.storagePath);
    return new Response(null, { status: 303, headers: { ...headers, Location: url } });
  } catch {
    return Response.json({ error: "File download is temporarily unavailable" }, { status: 503, headers });
  }
}
