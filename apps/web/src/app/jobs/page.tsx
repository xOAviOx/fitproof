import { listUserJobs } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { BandBadge } from "./band";

export const metadata: Metadata = { title: "Your jobs" };

const STATUS_TEXT = { pending: "Reading…", failed: "Needs attention", ready: "Not compared yet" } as const;

export default async function JobsPage() {
  const user = await requireUser();
  const jobs = await listUserJobs(getDb(), user.id);
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b pb-8">
        <div>
          <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">03 / YOUR JOBS</p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Jobs you’ve checked</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Every job you add is private to you. Open one to see the evidence behind its match.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/jobs/new">Check a job</Link>
        </Button>
      </div>
      {jobs.length === 0 ? (
        <div className="border border-dashed px-6 py-12 text-center">
          <p className="font-medium">No jobs yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Paste a job description or a careers-page link to see how your experience fits.
          </p>
        </div>
      ) : (
        <ul className="divide-y border-y">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="grid gap-2 px-1 py-4 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{job.title}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {job.companyName} · {job.sourceName} ·{" "}
                    {job.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  {job.closedAt && (
                    <span className="font-mono text-[11px] uppercase tracking-wider text-destructive">
                      Closed
                    </span>
                  )}
                  {job.saved && (
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      Saved
                    </span>
                  )}
                  {job.band && job.requirementsStatus === "ready" ? (
                    <BandBadge band={job.band} />
                  ) : (
                    <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                      {STATUS_TEXT[job.requirementsStatus]}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
