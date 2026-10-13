import {
  type EligibilityOutcome,
  type ExperienceSummary,
  evaluateJobEligibility,
  type Preferences,
} from "@repo/core";
import { cn } from "@/lib/utils";
import { EXAMPLE_JOBS } from "./example-jobs";

const OUTCOME_LABELS: Record<EligibilityOutcome, string> = {
  eligible: "Shown",
  check: "Shown with checks",
  excluded: "Filtered out",
};

export function FilterPreview({
  preferences,
  experience,
  today,
}: {
  preferences: Preferences;
  experience: ExperienceSummary | null;
  today: string;
}) {
  return (
    <section aria-labelledby="filter-preview-heading" className="space-y-4">
      <div>
        <h3 id="filter-preview-heading" className="text-lg font-semibold tracking-tight">
          Try your filters on example postings
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          These postings are made up, not real jobs. Real results use the same rules, and filtered jobs stay
          visible with the reason.
        </p>
      </div>
      <ul className="space-y-3">
        {EXAMPLE_JOBS.map((example) => {
          const result = evaluateJobEligibility({ preferences, experience }, example.job, today);
          const issues = result.checks
            .filter((item) => item.status !== "met")
            .sort((a, b) => Number(b.status === "unmet") - Number(a.status === "unmet"));
          const passed = result.checks.length - issues.length;
          const titleId = `example-${example.id}`;
          return (
            <li key={example.id}>
              <article
                aria-labelledby={titleId}
                className={cn(
                  "border p-4",
                  result.outcome === "excluded" && "border-dashed bg-muted/40",
                  result.outcome === "eligible" && "border-foreground/40",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 id={titleId} className="font-medium">
                      {example.title}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      {example.company} · {example.summary}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest",
                      result.outcome === "excluded" && "border-destructive/60 text-destructive",
                      result.outcome === "eligible" && "border-foreground bg-foreground text-background",
                    )}
                  >
                    {OUTCOME_LABELS[result.outcome]}
                  </span>
                </div>
                {issues.length > 0 && (
                  <ul className="mt-3 space-y-2 border-t pt-3">
                    {issues.map((item) => (
                      <li key={`${item.source}:${item.kind}:${item.message}`} className="text-sm">
                        <span className="mr-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                          {item.status === "unmet" ? "Reason" : "Check"}
                        </span>
                        {item.message}
                        {item.source === "requirement" && (
                          <blockquote className="mt-1 border-l-2 pl-3 text-xs text-muted-foreground">
                            From the posting: “{item.quote}”
                          </blockquote>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-muted-foreground">
                  {passed} {passed === 1 ? "rule" : "rules"} passed
                  {result.checks.length === 0 ? " (nothing to compare yet)" : ""}
                </p>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
