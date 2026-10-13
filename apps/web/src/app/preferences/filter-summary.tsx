import type { FilterRule } from "@repo/core";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<FilterRule["kind"], string> = {
  filter: "Filter",
  eligibility: "Compared",
  missing: "Check",
};

export function FilterSummary({ rules }: { rules: FilterRule[] }) {
  return (
    <dl className="divide-y border-y">
      {rules.map((rule) => (
        <div key={rule.id} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <dt className="flex items-baseline justify-between gap-2 text-sm font-medium sm:block">
            {rule.label}
            <span
              className={cn(
                "font-mono text-[10px] uppercase tracking-widest sm:mt-1 sm:block",
                rule.kind === "missing"
                  ? "text-foreground underline decoration-dotted"
                  : "text-muted-foreground",
              )}
            >
              {KIND_LABELS[rule.kind]}
            </span>
          </dt>
          <dd className="min-w-0">
            <p className="text-sm break-words">{rule.value}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{rule.effect}</p>
          </dd>
        </div>
      ))}
    </dl>
  );
}
