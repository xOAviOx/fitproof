import { loadUserJobStatus } from "@repo/db";
import { z } from "zod";
import { analyzeInBackground } from "@/lib/analysis";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

// A due retry is picked up here while the user watches, within this route's time limit.
export const maxDuration = 300;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401, headers });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "Not found" }, { status: 404, headers });
  const status = await loadUserJobStatus(getDb(), user.id, id.data);
  if (!status) return Response.json({ error: "Not found" }, { status: 404, headers });
  // Claiming is atomic and only succeeds once the run is due, so repeated polls are harmless.
  if (status.runId && status.run === "queued") analyzeInBackground(status.runId);
  return Response.json(
    {
      requirements: status.requirements,
      explanation: status.explanation,
      computedAt: status.computedAt,
      run: status.run,
      error: status.error,
    },
    { headers },
  );
}
