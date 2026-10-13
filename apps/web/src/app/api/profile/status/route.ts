import { loadResumeStatus } from "@repo/db";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  const headers = { "Cache-Control": "no-store" };
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401, headers });
  const status = await loadResumeStatus(getDb(), user.id);
  return Response.json(status, { headers });
}
