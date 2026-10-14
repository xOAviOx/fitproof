import { APPLICATION_STATUS_LABELS, APPLICATION_STATUSES } from "@repo/core";
import { listApplications } from "@repo/db";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { BandBadge } from "../jobs/band";
import { TrackerEntryForm } from "./tracker-entry";

export const metadata: Metadata = { title: "Tracker" };

const date = (value: Date) =>
  value.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function TrackerPage() {
  const user = await requireUser();
  const entries = await listApplications(getDb(), user.id);
  const counts = APPLICATION_STATUSES.map((status) => ({
    status,
    count: entries.filter((entry) => entry.status === status).length,
  })).filter((item) => item.count > 0);
  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-14">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4 border-b pb-8">
        <div>
          <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">
            04 / YOUR APPLICATIONS
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Tracker</h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Jobs you saved, where each one stands, and what to do next.
          </p>
        </div>
        {counts.length > 0 && (
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {counts.map((item) => (
              <div key={item.status}>
                <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {APPLICATION_STATUS_LABELS[item.status]}
                </dt>
                <dd className="text-2xl font-semibold tabular-nums">{item.count}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="border border-dashed px-6 py-12 text-center">
          <p className="font-medium">Nothing saved yet</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Check a job, then choose “Save to tracker” to follow it here.
          </p>
          <Button asChild className="mt-6">
            <Link href="/jobs/new">Check a job</Link>
          </Button>
        </div>
      ) : (
        <ol className="space-y-6">
          {entries.map((entry) => (
            <li key={entry.id} className="border p-5">
              <article aria-labelledby={`entry-${entry.id}-title`} className="space-y-5">
                <header className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 id={`entry-${entry.id}-title`} className="text-lg font-semibold break-words">
                      {entry.jobAvailable && entry.jobId ? (
                        <Link
                          href={`/jobs/${entry.jobId}`}
                          className="hover:underline hover:underline-offset-4"
                        >
                          {entry.jobTitle}
                        </Link>
                      ) : (
                        entry.jobTitle
                      )}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {entry.companyName} · Saved {date(entry.createdAt)}
                      {entry.appliedAt && ` · Applied ${date(entry.appliedAt)}`}
                      {(entry.jobClosedAt || !entry.jobAvailable) && " · Posting no longer available"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.band && <BandBadge band={entry.band} />}
                    {entry.applyUrl && (
                      <a
                        href={entry.applyUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-sm underline underline-offset-4"
                      >
                        Open posting
                      </a>
                    )}
                  </div>
                </header>
                <TrackerEntryForm
                  id={entry.id}
                  title={entry.jobTitle}
                  revision={entry.updatedAt.toISOString()}
                  status={entry.status}
                  notes={entry.notes ?? ""}
                  nextActionAt={entry.nextActionAt ? entry.nextActionAt.toISOString().slice(0, 10) : ""}
                />
              </article>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
