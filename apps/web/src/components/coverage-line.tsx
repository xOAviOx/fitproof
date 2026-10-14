import "server-only";
import { describeCoverage } from "@repo/core";
import { loadCoverage } from "@repo/db";
import { AdzunaAttribution } from "@/components/adzuna-attribution";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";

/** Which sources were read recently. Rendered on public pages, so a database error hides it instead. */
export async function CoverageLine({ className }: { className?: string }) {
  let coverage: Awaited<ReturnType<typeof loadCoverage>>;
  try {
    coverage = await loadCoverage(getDb());
  } catch (error) {
    logger.warn({ err: error }, "coverage line unavailable");
    return null;
  }
  const text = describeCoverage(coverage);
  if (!text) return null;
  return (
    <p className={cn("text-sm text-muted-foreground", className)} data-testid="coverage-line">
      {text}
      {coverage.adzuna && (
        <>
          {" "}
          <AdzunaAttribution className="text-foreground" />
        </>
      )}
    </p>
  );
}
