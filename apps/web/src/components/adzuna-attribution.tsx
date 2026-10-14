import { cn } from "@/lib/utils";

/**
 * Adzuna's API terms ask for "Adzuna" on every displayed ad, at least 116 × 23 px, linked to the
 * local Adzuna site. The minimum size is enforced here so callers can't shrink it below that.
 */
export function AdzunaAttribution({ className }: { className?: string }) {
  return (
    <a
      href="https://www.adzuna.in"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-h-[23px] min-w-[116px] items-center text-base font-semibold underline underline-offset-4",
        className,
      )}
    >
      Jobs by Adzuna
    </a>
  );
}
