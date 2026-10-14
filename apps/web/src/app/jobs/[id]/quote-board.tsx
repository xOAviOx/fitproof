"use client";

import type { GapResponse, HighlightSegment } from "@repo/core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { GapAnswer } from "./job-actions";

export type MarkKind = "match" | "gap" | "check";
export type BoardItem = {
  id: string;
  kind: MarkKind;
  requirement: string;
  typeLabel: string;
  jobQuote: string;
  resumeQuote: string | null;
  tier: string | null;
  note: string | null;
  /** Gaps and strengths that came from a gap answer. */
  skill: string | null;
  response: GapResponse | null;
};
export type EvidenceBlock = {
  ref: string;
  heading: string;
  kindLabel: string;
  lines: HighlightSegment[][];
  chips: { name: string; ids: string[] }[];
};

const PRIORITY: MarkKind[] = ["gap", "check", "match"];
const MARK_STYLES: Record<MarkKind, string> = {
  match: "bg-amber-200/70 dark:bg-amber-400/30",
  gap: "bg-rose-100/80 underline decoration-rose-500 decoration-2 underline-offset-4 dark:bg-rose-500/20",
  check:
    "bg-sky-100/80 underline decoration-sky-600 decoration-dotted decoration-2 underline-offset-4 dark:bg-sky-500/20",
};
const SECTIONS: { kind: MarkKind; title: string; empty: string }[] = [
  {
    kind: "match",
    title: "Where you match",
    empty: "None of your confirmed evidence covers this job's requirements yet.",
  },
  {
    kind: "gap",
    title: "Gaps to close",
    empty: "No skill gaps. Every listed skill is backed by your evidence.",
  },
  { kind: "check", title: "Eligibility and checks", empty: "The posting states no eligibility conditions." },
];

function Marked({
  segments,
  kinds,
  active,
}: {
  segments: HighlightSegment[];
  kinds: ReadonlyMap<string, MarkKind>;
  active: string | null;
}) {
  let offset = 0;
  return segments.map((segment) => {
    const start = offset;
    offset += segment.text.length;
    if (!segment.ids.length) return <span key={start}>{segment.text}</span>;
    const present = segment.ids.map((id) => kinds.get(id)).filter((kind) => kind !== undefined);
    const kind = PRIORITY.find((candidate) => present.includes(candidate)) ?? "match";
    const isActive = active !== null && segment.ids.includes(active);
    return (
      <mark
        key={start}
        data-ids={segment.ids.join(" ")}
        className={cn(
          "rounded-[2px] text-inherit transition-[outline-color,background-color] duration-200",
          MARK_STYLES[kind],
          isActive ? "outline-2 outline-offset-1 outline-foreground" : "outline-transparent",
        )}
      >
        {segment.text}
      </mark>
    );
  });
}

function Pane({
  title,
  caption,
  innerRef,
  children,
}: {
  title: string;
  caption: string;
  innerRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col border bg-background">
      <header className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
        <h3 className="font-mono text-xs tracking-[0.16em]">{title.toUpperCase()}</h3>
        <p className="text-xs text-muted-foreground">{caption}</p>
      </header>
      <div ref={innerRef} className="relative max-h-[34rem] overflow-y-auto px-4 py-4">
        {children}
      </div>
    </section>
  );
}

/**
 * The explanation and its evidence: every strength, gap, and check links to the exact lines in the
 * posting and in the user's confirmed profile, highlighted side by side.
 */
export function QuoteBoard({
  jobId,
  items,
  jobSegments,
  evidence,
}: {
  jobId: string;
  items: BoardItem[];
  jobSegments: HighlightSegment[];
  evidence: EvidenceBlock[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const jobPane = useRef<HTMLDivElement>(null);
  const evidencePane = useRef<HTMLDivElement>(null);
  const kinds = new Map(items.map((item) => [item.id, item.kind]));
  const activeItem = items.find((item) => item.id === active) ?? null;

  useEffect(() => {
    if (!active) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const pane of [jobPane.current, evidencePane.current]) {
      const target = pane?.querySelector<HTMLElement>(`[data-ids~="${CSS.escape(active)}"]`);
      if (pane && target)
        pane.scrollTo({ top: Math.max(0, target.offsetTop - 48), behavior: smooth ? "smooth" : "auto" });
    }
  }, [active]);

  const show = (id: string) => {
    setActive(id);
    board.current?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  return (
    <div className="space-y-14">
      <div className="grid gap-10 lg:grid-cols-3">
        {SECTIONS.map((section) => {
          const list = items.filter((item) => item.kind === section.kind);
          return (
            <section key={section.kind} aria-labelledby={`section-${section.kind}`} className="min-w-0">
              <h2
                id={`section-${section.kind}`}
                className="flex items-baseline justify-between border-b border-foreground pb-2 text-lg font-semibold"
              >
                {section.title}
                <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">
                  {String(list.length).padStart(2, "0")}
                </span>
              </h2>
              {list.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">{section.empty}</p>
              ) : (
                <ul className="divide-y">
                  {list.map((item) => (
                    <li key={item.id} className="space-y-2 py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h3 className="font-medium">{item.requirement}</h3>
                        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                          {item.tier ?? item.typeLabel}
                        </span>
                      </div>
                      <blockquote
                        className={cn(
                          "border-l-2 pl-3 text-sm leading-relaxed",
                          item.kind === "match"
                            ? "border-amber-500"
                            : item.kind === "gap"
                              ? "border-rose-500"
                              : "border-sky-600",
                        )}
                      >
                        <span className="sr-only">
                          {item.kind === "match" ? "From your profile: " : "From the posting: "}
                        </span>
                        “{item.kind === "match" ? item.resumeQuote : item.jobQuote}”
                      </blockquote>
                      {item.note && <p className="text-sm text-muted-foreground">{item.note}</p>}
                      {item.kind === "gap" && item.skill && (
                        <>
                          {item.response === "does_not_have" && (
                            <p className="text-xs text-muted-foreground">You said you don’t have this yet.</p>
                          )}
                          <GapAnswer
                            jobId={jobId}
                            requirementId={item.id}
                            skill={item.requirement}
                            response={item.response}
                          />
                        </>
                      )}
                      {item.kind === "match" && item.response === "has_it" && item.skill && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            Added to your profile from this job as a self-declared skill.
                          </p>
                          <GapAnswer
                            jobId={jobId}
                            requirementId={item.id}
                            skill={item.requirement}
                            response={item.response}
                            undoOnly
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => show(item.id)}
                        aria-pressed={active === item.id}
                        className="font-mono text-[11px] uppercase tracking-wider underline underline-offset-4 hover:text-foreground"
                      >
                        Show in context
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section ref={board} aria-labelledby="side-by-side" className="scroll-mt-6 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs tracking-[0.16em] text-muted-foreground">THE RECEIPTS</p>
            <h2 id="side-by-side" className="text-2xl font-semibold tracking-tight">
              Side by side
            </h2>
          </div>
          <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
            <li className="flex items-center gap-2">
              <span className={cn("inline-block h-3 w-5", MARK_STYLES.match)} /> Backed by your evidence
            </li>
            <li className="flex items-center gap-2">
              <span className={cn("inline-block h-3 w-5", MARK_STYLES.gap)} /> Gap
            </li>
            <li className="flex items-center gap-2">
              <span className={cn("inline-block h-3 w-5", MARK_STYLES.check)} /> Check
            </li>
          </ul>
        </div>
        <p aria-live="polite" className="min-h-5 text-sm">
          {activeItem ? (
            <>
              Showing <strong className="font-medium">{activeItem.requirement}</strong>
              {activeItem.kind === "match"
                ? ": the posting line and your evidence for it."
                : activeItem.kind === "gap"
                  ? ": your confirmed profile doesn’t show this yet."
                  : ": confirm this yourself before applying."}
            </>
          ) : (
            <span className="text-muted-foreground">
              Choose “Show in context” on any item to find its lines.
            </span>
          )}
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <Pane title="The posting" caption="As you added it" innerRef={jobPane}>
            <p className="whitespace-pre-wrap break-words text-sm leading-7">
              <Marked segments={jobSegments} kinds={kinds} active={active} />
            </p>
          </Pane>
          <Pane title="Your evidence" caption="Confirmed entries only" innerRef={evidencePane}>
            {evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No confirmed entries yet.</p>
            ) : (
              <ol className="space-y-6">
                {evidence.map((block) => (
                  <li key={block.ref} className="space-y-2">
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{block.heading}</span>
                      <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                        {block.kindLabel}
                      </span>
                    </p>
                    {block.lines.length > 0 && (
                      <ul className="space-y-1.5 text-sm leading-6">
                        {block.lines.map((line, index) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: lines come from a fixed profile entry and never reorder.
                          <li key={index} className="break-words">
                            <Marked segments={line} kinds={kinds} active={active} />
                          </li>
                        ))}
                      </ul>
                    )}
                    {block.chips.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5" aria-label="Skills">
                        {block.chips.map((chip) => (
                          <li key={chip.name} className="border px-1.5 py-0.5 text-xs">
                            <Marked
                              segments={[{ text: chip.name, ids: chip.ids }]}
                              kinds={kinds}
                              active={active}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Pane>
        </div>
      </section>
    </div>
  );
}
