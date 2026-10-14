import { COLLECTION_RUN_KINDS } from "@repo/core";
import { describe, expect, it } from "vitest";
import { formatDuration, summarizeRun } from "./run-summary";

const stats = (overrides: Record<string, number> = {}) => ({
  boards: 2,
  failed: 1,
  listed: 40,
  inScope: 6,
  skipped: { location: 30, role: 3, seniority: 1 },
  new: 4,
  changed: 1,
  unchanged: 1,
  grouped: 1,
  closed: 2,
  postingErrors: 0,
  ...overrides,
});

describe("summarizeRun", () => {
  it("totals an ingest run across sources, counting Adzuna postings but not as boards", () => {
    const line = summarizeRun(COLLECTION_RUN_KINDS.ingest, {
      sources: { greenhouse: stats(), lever: stats({ failed: 0 }), adzuna: stats({ boards: 0, failed: 0 }) },
      failures: [{ company: "acme", source: "greenhouse", error: "404" }],
      registry: null,
      adzuna: "ran",
      partial: true,
      requests: 31,
    });
    expect(line).toBe(
      "4 boards (1 failed) · 18 of 120 postings in scope · 12 new, 3 changed, 6 closed, 3 grouped · Adzuna searched · 31 requests · stopped at the time budget",
    );
  });

  it("summarizes a verify run", () => {
    expect(
      summarizeRun(COLLECTION_RUN_KINDS.verify, {
        adzunaClosed: 3,
        userLinks: { checked: 5, open: 3, closed: 1, unknown: 1 },
        pruned: 12,
        staleAfterHours: 48,
      }),
    ).toBe("3 Adzuna ads closed · 5 user links checked (1 closed, 1 unreachable) · 12 old postings pruned");
  });

  it("degrades to zeros for unexpected shapes and ignores other kinds", () => {
    expect(summarizeRun(COLLECTION_RUN_KINDS.ingest, { sources: "nope", requests: -1 })).toMatch(
      /^0 boards \(0 failed\)/,
    );
    expect(summarizeRun(COLLECTION_RUN_KINDS.verify, null)).toBeNull();
    expect(summarizeRun("job.analyze", { anything: true })).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats seconds and minutes, and needs both timestamps", () => {
    const start = new Date("2026-10-10T00:00:00Z");
    expect(formatDuration(start, new Date("2026-10-10T00:00:42Z"))).toBe("42s");
    expect(formatDuration(start, new Date("2026-10-10T00:12:05Z"))).toBe("12m 05s");
    expect(formatDuration(start, null)).toBeNull();
  });
});
