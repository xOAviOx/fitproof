import { pingDatabase } from "@repo/db";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { describeError } from "@/lib/errors";
import { checkHealth } from "@/lib/health";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await checkHealth(() => pingDatabase(getDb()), {
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    onError: (error) => logger.error({ err: describeError(error) }, "health check failed"),
  });
  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
