import { MATCH_BAND_LABELS, type MatchBand } from "@repo/core";
import { cn } from "@/lib/utils";

const STYLES: Record<MatchBand, string> = {
  strong: "border-emerald-700/40 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100",
  good: "border-teal-700/40 bg-teal-50 text-teal-950 dark:bg-teal-950/40 dark:text-teal-100",
  partial: "border-amber-700/40 bg-amber-50 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100",
  low: "border-stone-500/40 bg-stone-100 text-stone-800 dark:bg-stone-800/40 dark:text-stone-100",
  excluded: "border-rose-700/40 bg-rose-50 text-rose-950 dark:bg-rose-950/40 dark:text-rose-100",
};
const FILLED: Record<MatchBand, number> = { strong: 4, good: 3, partial: 2, low: 1, excluded: 0 };

/** A band, never a number: four steps, plus "Not eligible". */
export function BandBadge({ band, size = "sm" }: { band: MatchBand; size?: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 border font-mono uppercase tracking-wider",
        size === "lg" ? "px-3 py-2 text-sm" : "px-2 py-1 text-[11px]",
        STYLES[band],
      )}
    >
      <span aria-hidden="true" className="flex gap-0.5">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={cn(
              "block w-1.5 border border-current",
              size === "lg" ? "h-3.5" : "h-2.5",
              step <= FILLED[band] ? "bg-current" : "opacity-40",
            )}
          />
        ))}
      </span>
      <span>
        <span className="sr-only">Match: </span>
        {MATCH_BAND_LABELS[band]}
      </span>
    </span>
  );
}
