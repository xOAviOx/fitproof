import { loadMatchContext, readStoredMatch, withGapResponses } from "@repo/analysis";
import {
  EMPLOYMENT_TYPE_LABELS,
  EVIDENCE_LABELS,
  formatLpa,
  highlightSegments,
  indiaToday,
  MATCH_BAND_DESCRIPTIONS,
  normalizeQuote,
  profileEvidence,
  REQUIREMENT_TYPE_LABELS,
  type RemoteType,
} from "@repo/core";
import { loadUserJob, type UserJob } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AdzunaAttribution } from "@/components/adzuna-attribution";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { BandBadge } from "../band";
import { AnalysisStatus } from "./analysis-status";
import { RecheckButton, SaveJobButton } from "./job-actions";
import { type BoardItem, type EvidenceBlock, QuoteBoard } from "./quote-board";

export const metadata: Metadata = { title: "Job match" };
// Re-checks started here run after the response, within this route's time limit.
export const maxDuration = 300;

const REMOTE_LABELS: Record<RemoteType, string | null> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
  unknown: null,
};
const CHECK_LABELS = { met: "Met", unmet: "Not met", check: "Check" } as const;
const CHECK_ORDER = { unmet: 0, check: 1, met: 2 } as const;
const KIND_LABELS = {
  experience: "Work",
  project: "Project",
  education: "Education",
  certification: "Certification",
  skill: "Skill",
} as const;

function salaryText(job: UserJob["job"]) {
  if (job.salaryMin === null && job.salaryMax === null) return null;
  if (job.salaryCurrency === "INR" && job.salaryPeriod === "year") {
    return [job.salaryMin, job.salaryMax]
      .filter((value) => value !== null)
      .map((value) => formatLpa(value))
      .join(" – ");
  }
  return null;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="border-l-2 border-foreground/50 bg-muted/40 px-4 py-3 text-sm">{children}</div>;
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const data = await loadUserJob(getDb(), user.id, id.data);
  if (!data) notFound();
  const { job, requirements, run } = data;
  const stored = readStoredMatch(data.match);
  const active = run?.status === "queued" || run?.status === "running";
  const context = stored ? await loadMatchContext(getDb(), user.id, indiaToday()) : null;
  const stale = Boolean(stored && context && data.match?.profileHash !== context.profileHash);
  const facts = [
    job.companyName,
    job.locations.join(", "),
    REMOTE_LABELS[job.remoteType],
    job.employmentType === "unknown" ? null : EMPLOYMENT_TYPE_LABELS[job.employmentType],
    salaryText(job),
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <Link href="/jobs" className="underline underline-offset-4">
          Your jobs
        </Link>{" "}
        / This job
      </nav>
      <div className="mb-10 flex flex-wrap items-start justify-between gap-6 border-b pb-8">
        <div className="min-w-0 max-w-3xl">
          <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">
            {job.sourceName.toUpperCase()}
            {job.sourceUrl && (
              <>
                {" · "}
                <a
                  href={job.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline underline-offset-4"
                >
                  OPEN POSTING
                </a>
              </>
            )}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight break-words sm:text-4xl">{job.title}</h1>
          {facts.length > 0 && <p className="mt-3 text-sm text-muted-foreground">{facts.join(" · ")}</p>}
          {job.source === "adzuna" && <AdzunaAttribution className="mt-3" />}
        </div>
        <div className="flex flex-col items-start gap-3 sm:items-end">
          {data.match && <BandBadge band={data.match.band} size="lg" />}
          {data.application ? (
            <p className="text-sm">
              Saved ·{" "}
              <Link href="/tracker" className="underline underline-offset-4">
                View in tracker
              </Link>
            </p>
          ) : (
            <SaveJobButton jobId={job.id} />
          )}
        </div>
      </div>

      <div className="mb-10 space-y-4">
        {job.closedAt && (
          <Notice>
            This posting looked closed when we checked it on{" "}
            {job.closedAt.toLocaleDateString("en-IN", { dateStyle: "medium" })}: the page was gone, said it
            had stopped taking applications, or the company’s board no longer listed it. Check the careers
            page before you apply.
          </Notice>
        )}
        {active && (
          <AnalysisStatus
            jobId={job.id}
            rechecking={Boolean(stored)}
            initial={{
              requirements: job.requirementsStatus,
              explanation: data.match?.explanationStatus ?? null,
              computedAt: data.match?.computedAt.toISOString() ?? null,
              run: run?.status ?? null,
              error: run?.error ?? null,
            }}
          />
        )}
        {!active && job.requirementsStatus === "failed" && (
          <div
            role="alert"
            className="space-y-3 border-l-2 border-destructive bg-destructive/5 px-4 py-3 text-sm"
          >
            <p className="font-medium">We couldn’t analyse this job</p>
            <p>{run?.error ?? "Something went wrong while reading the posting."}</p>
            <div className="flex flex-wrap gap-3">
              <RecheckButton jobId={job.id} label="Try again" />
              <Link href="/jobs/new" className="self-center underline underline-offset-4">
                Add it again with the full description
              </Link>
            </div>
          </div>
        )}
        {stored && stale && !active && (
          <Notice>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>Your profile or preferences changed since this job was checked.</p>
              <RecheckButton jobId={job.id} />
            </div>
          </Notice>
        )}
        {stored?.explanation.extraction === "keywords" && (
          <Notice>
            Read without AI: only skills from our vocabulary were detected, and eligibility conditions weren’t
            read. Check the posting yourself for experience, degree, and location rules.
          </Notice>
        )}
        {stored &&
          stored.explanation.extraction === "model" &&
          data.match?.explanationStatus === "fallback" && (
            <Notice>
              We couldn’t verify a written explanation against your profile, so this shows only the overlap we
              could check line by line.
            </Notice>
          )}
      </div>

      {stored && data.match && context && (
        <JobMatch data={data} stored={stored} evidence={profileEvidence(context.content)} />
      )}
      {!stored && !active && job.requirementsStatus === "ready" && (
        <Notice>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>This job hasn’t been compared with your profile yet.</p>
            <RecheckButton jobId={job.id} label="Compare now" variant="default" />
          </div>
        </Notice>
      )}
      {requirements.length === 0 && job.requirementsStatus !== "ready" && (
        <details className="mt-10 border-t pt-6">
          <summary className="cursor-pointer text-sm font-medium">The text you added</summary>
          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
            {job.descriptionText}
          </p>
        </details>
      )}
    </main>
  );
}

function JobMatch({
  data,
  stored,
  evidence,
}: {
  data: UserJob;
  stored: NonNullable<ReturnType<typeof readStoredMatch>>;
  evidence: ReturnType<typeof profileEvidence>;
}) {
  const { job, requirements, gapResponses } = data;
  const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const explanation = withGapResponses(stored.explanation.explanation, gapResponses);
  const checkNotes = new Map(explanation.checks.map((check) => [check.requirementId, check.note]));
  const items: BoardItem[] = [
    ...explanation.strengths.map((strength) => {
      const requirement = byId.get(strength.requirementId);
      return {
        id: strength.requirementId,
        kind: "match" as const,
        requirement: strength.requirement,
        typeLabel: requirement ? REQUIREMENT_TYPE_LABELS[requirement.type] : "",
        jobQuote: requirement?.quote ?? "",
        resumeQuote: strength.resumeQuote,
        tier: strength.tier ? EVIDENCE_LABELS[strength.tier] : null,
        note: strength.note,
        skill: requirement?.skill ?? null,
        response: gapResponses.get(strength.requirementId) ?? null,
      };
    }),
    ...explanation.gaps.map((gap) => ({
      id: gap.requirementId,
      kind: "gap" as const,
      requirement: gap.requirement,
      typeLabel: gap.core ? "Core skill" : "Nice to have",
      jobQuote: gap.jobQuote,
      resumeQuote: null,
      tier: null,
      note: gap.note,
      skill: gap.skill,
      response: gap.response,
    })),
    ...[...stored.score.requirementChecks]
      .sort((a, b) => CHECK_ORDER[a.check.status] - CHECK_ORDER[b.check.status])
      .map(({ requirementId, check }) => ({
        id: requirementId,
        kind: "check" as const,
        requirement: check.message,
        typeLabel: CHECK_LABELS[check.status],
        jobQuote: check.source === "requirement" ? check.quote : "",
        resumeQuote: null,
        tier: null,
        note: checkNotes.get(requirementId) ?? null,
        skill: null,
        response: null,
      })),
    ...stored.score.unclear.map((item) => ({
      id: item.requirementId,
      kind: "check" as const,
      requirement: item.text,
      typeLabel: "Unclear",
      jobQuote: item.quote,
      resumeQuote: null,
      tier: null,
      note: checkNotes.get(item.requirementId) ?? null,
      skill: null,
      response: null,
    })),
  ];
  const resumeMarks = items
    .filter((item) => item.kind === "match" && item.resumeQuote)
    .map((item) => ({ id: item.id, quote: item.resumeQuote ?? "" }));
  const sameText = (a: string, b: string) => normalizeQuote(a) === normalizeQuote(b);
  const chipsFor = (names: string[]) =>
    names.map((name) => ({
      name,
      ids: resumeMarks.filter((mark) => sameText(mark.quote, name)).map((mark) => mark.id),
    }));
  const skills = evidence.filter((item) => item.kind === "skill");
  const blocks: EvidenceBlock[] = [
    ...evidence
      .filter((item) => item.kind !== "skill")
      .map((item) => ({
        ref: item.ref,
        heading: item.heading,
        kindLabel: item.kind === "experience" ? EVIDENCE_LABELS[item.tier] : KIND_LABELS[item.kind],
        lines: item.texts.map((text) => highlightSegments(text, resumeMarks)),
        chips: chipsFor(item.skills),
      })),
    ...(skills.length
      ? [
          {
            ref: "skills",
            heading: "Skills",
            kindLabel: "Listed",
            lines: [],
            chips: chipsFor(skills.map((item) => item.heading)),
          },
        ]
      : []),
  ];
  const preferenceChecks = stored.score.preferenceChecks;

  return (
    <div className="space-y-14">
      <section
        aria-labelledby="verdict"
        className="grid gap-6 border-b pb-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
      >
        <div className="space-y-3">
          <h2 id="verdict" className="font-mono text-xs tracking-[0.16em] text-muted-foreground">
            THE SHORT VERSION
          </h2>
          <p className="text-xl leading-relaxed">{MATCH_BAND_DESCRIPTIONS[stored.score.band]}</p>
          {explanation.summary && (
            <p className="leading-relaxed text-muted-foreground">{explanation.summary}</p>
          )}
        </div>
        {preferenceChecks.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-mono text-xs tracking-[0.16em] text-muted-foreground">YOUR PREFERENCES</h2>
            <ul className="space-y-2 text-sm">
              {preferenceChecks.map((check) => (
                <li key={check.kind} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    {CHECK_LABELS[check.status]}
                  </span>
                  <span>{check.message}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Preferences order your jobs. They never hide one you added.{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Edit
              </Link>
            </p>
          </div>
        )}
      </section>
      <QuoteBoard
        jobId={job.id}
        items={items}
        jobSegments={highlightSegments(
          job.descriptionText,
          items.filter((item) => item.jobQuote).map((item) => ({ id: item.id, quote: item.jobQuote })),
        )}
        evidence={blocks}
      />
    </div>
  );
}
