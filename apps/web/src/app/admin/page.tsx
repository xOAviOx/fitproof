import { COLLECTION_CONFIG, JOB_SOURCE_LABELS, type JobSource, SCORING_CONFIG } from "@repo/core";
import { loadCollectionStats } from "@repo/db";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDuration, summarizeRun } from "@/lib/run-summary";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

const dateTime = (value: Date | null) =>
  value
    ? value.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      })
    : "Never";
const number = (value: number) => value.toLocaleString("en-IN");
const percent = (found: number, total: number) => (total ? `${Math.round((found / total) * 100)}%` : "–");
const sourceLabel = (source: string) => JOB_SOURCE_LABELS[source as JobSource] ?? source;

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="font-mono text-xs tracking-[0.16em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A count that needs attention when it isn't zero. */
type Cell = string | { alert: string };
/** Each row starts with a unique label, which doubles as its key. */
type Row = [label: string, ...cells: Cell[]];

const alertIfAny = (value: number): Cell => (value > 0 ? { alert: number(value) } : "0");

function Table({ head, rows, empty }: { head: string[]; rows: Row[]; empty: string }) {
  if (rows.length === 0) return <p className="border border-dashed px-4 py-6 text-sm">{empty}</p>;
  return (
    <div className="overflow-x-auto border-y">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            {head.map((cell, index) => (
              <th
                key={cell}
                scope="col"
                className={`px-2 py-2 font-mono text-[11px] font-normal uppercase tracking-wider text-muted-foreground ${index > 0 ? "text-right" : ""}`}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td
                  key={head[index]}
                  className={`px-2 py-2 align-top ${index > 0 ? "text-right tabular-nums" : ""}`}
                >
                  {typeof cell === "string" ? cell : <span className="text-destructive">{cell.alert}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AdminPage() {
  await requireAdmin();
  const stats = await loadCollectionStats(getDb());
  const open = stats.jobs.openBySource.reduce((sum, row) => sum + row.open, 0);
  const stale = stats.jobs.openBySource.reduce((sum, row) => sum + row.stale, 0);
  const boards = stats.boards.reduce((sum, row) => sum + row.total, 0);
  const failing = stats.boards.reduce((sum, row) => sum + row.failing, 0);
  const postings = new Map(stats.postings.map((row) => [row.source, row]));
  const sources = [...new Set([...stats.jobs.openBySource.map((row) => row.source), ...postings.keys()])];
  const staleHours = SCORING_CONFIG.freshness.staleAfterHours;

  return (
    <main id="main" className="mx-auto w-full max-w-5xl flex-1 space-y-12 px-4 py-10 sm:py-14">
      <div className="border-b pb-8">
        <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">ADMIN / COLLECTION</p>
        <h1 className="text-4xl font-semibold tracking-tight">Job collection</h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Live from the database. Boards are re-read every {COLLECTION_CONFIG.everyHours} hours; a job counts
          as stale when nothing has confirmed it for {staleHours} hours.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-6 sm:grid-cols-4">
        {[
          ["Open jobs", number(open)],
          [`Unconfirmed for ${staleHours}h`, number(stale)],
          ["Closed this week", number(stats.jobs.closedThisWeek)],
          ["Duplicates grouped", number(stats.jobs.groupedDuplicates)],
        ].map(([label, value]) => (
          <div key={label} className="border-t pt-3">
            <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <Section id="boards" title={`BOARDS · ${number(boards)} ACTIVE · ${number(failing)} FAILING`}>
        <Table
          head={["ATS", "Boards", "Failing", "Never read", "Last read"]}
          empty="No boards in the registry yet. Run the ingest once to sync data/companies.seed.json."
          rows={stats.boards.map((row) => [
            sourceLabel(row.ats),
            number(row.total),
            alertIfAny(row.failing),
            number(row.neverCrawled),
            dateTime(row.lastCrawledAt),
          ])}
        />
      </Section>

      <Section id="failing" title="FAILING BOARDS">
        {stats.failingCompanies.length === 0 ? (
          <p className="border border-dashed px-4 py-6 text-sm">
            Every board read successfully on its latest run.
          </p>
        ) : (
          <ul className="divide-y border-y">
            {stats.failingCompanies.map((company) => (
              <li
                key={company.slug}
                className="grid gap-1 px-2 py-3 text-sm sm:grid-cols-[14rem_minmax(0,1fr)]"
              >
                <span>
                  <span className="font-medium">{company.name}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {company.slug} · {company.ats ? sourceLabel(company.ats) : "no ATS"} ·{" "}
                    {dateTime(company.lastCrawledAt)}
                  </span>
                </span>
                <span className="break-words text-muted-foreground">{company.lastError}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="sources" title="JOBS BY SOURCE">
        <Table
          head={[
            "Source",
            "Open jobs",
            `Unconfirmed ${staleHours}h`,
            "Raw postings open",
            "Raw postings closed",
          ]}
          empty="No collected jobs yet."
          rows={sources.map((source) => {
            const jobRow = stats.jobs.openBySource.find((row) => row.source === source);
            const postingRow = postings.get(source);
            return [
              sourceLabel(source),
              number(jobRow?.open ?? 0),
              alertIfAny(jobRow?.stale ?? 0),
              number(postingRow?.open ?? 0),
              number(postingRow?.closed ?? 0),
            ];
          })}
        />
      </Section>

      <Section id="runs" title="RECENT RUNS">
        {stats.runs.length === 0 ? (
          <p className="border border-dashed px-4 py-6 text-sm">No ingest or verify runs yet.</p>
        ) : (
          <ul className="divide-y border-y">
            {stats.runs.map((run) => (
              <li key={run.id} className="grid gap-1 px-2 py-3 text-sm sm:grid-cols-[14rem_minmax(0,1fr)]">
                <span>
                  <span className="font-medium">{run.kind}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    <span className={run.status === "failed" ? "text-destructive" : undefined}>
                      {run.status.toUpperCase()}
                    </span>{" "}
                    · {dateTime(run.startedAt)}
                    {formatDuration(run.startedAt, run.finishedAt) &&
                      ` · ${formatDuration(run.startedAt, run.finishedAt)}`}
                  </span>
                </span>
                <span className="break-words text-muted-foreground">
                  {run.error ?? summarizeRun(run.kind, run.result) ?? "Still running"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="grid gap-12 lg:grid-cols-2">
        <Section id="quotes" title="REQUIREMENT QUOTES FOUND IN THE DESCRIPTION">
          <Table
            head={["Jobs", "Quotes", "Found", "Share"]}
            empty="No requirements yet."
            rows={(
              [
                ["Collected", stats.quotes.shared],
                ["Added by users", stats.quotes.private],
              ] as const
            ).map(([label, row]) => [
              label,
              number(row.total),
              number(row.found),
              percent(row.found, row.total),
            ])}
          />
        </Section>
        <Section id="tokens" title="MODEL USAGE · LAST 30 DAYS">
          <Table
            head={["Purpose · model", "Calls", "Input tokens", "Output tokens"]}
            empty="No model calls in the last 30 days."
            rows={stats.tokens.map((row) => [
              `${row.purpose} · ${row.model}`,
              number(row.calls),
              number(row.inputTokens),
              number(row.outputTokens),
            ])}
          />
        </Section>
      </div>
    </main>
  );
}
