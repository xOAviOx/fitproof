import { setTimeout as sleep } from "node:timers/promises";
import {
  type AnalysisDeps,
  analyzeJob,
  createAnalysisDeps,
  parseOptionalLlmEnv,
  readStoredMatch,
} from "@repo/analysis";
import {
  createUserJob,
  type Database,
  loadUserJob,
  RateLimitError,
  savePreferences,
  saveProfile,
} from "@repo/db";
import { createAuthUser, createTestDb } from "@repo/db/testing";
import type { JobExtractionResult, JobExtractor } from "@repo/llm";
import { type EvalDataset, loadDataset } from "./dataset";
import {
  type EvalMode,
  type EvalSummary,
  failedGates,
  type JobResult,
  type PairResult,
  scoreExtraction,
  summarize,
} from "./metrics";

const MAX_QUOTA_WAITS = 3;

/** Each posting is read once and shared by every profile it's paired with, to spend less quota. */
function sharedExtractor(extractor: JobExtractor): JobExtractor {
  const results = new Map<string, Promise<JobExtractionResult>>();
  return {
    extract(input) {
      let result = results.get(input.text);
      if (!result) {
        result = extractor.extract({ ...input, userId: null });
        results.set(input.text, result);
        result.catch(() => results.delete(input.text));
      }
      return result;
    },
  };
}

/** Per-minute quota is waited out; anything longer (a spent daily quota) stops the run. */
async function analyzeWithQuota(db: Database, deps: AnalysisDeps, input: { userId: string; jobId: string }) {
  for (let wait = 0; ; wait++) {
    try {
      const metrics = await analyzeJob(db, deps, input);
      if (metrics.explanation.error !== "rate_limited" || wait >= MAX_QUOTA_WAITS) return metrics;
    } catch (error) {
      if (!(error instanceof RateLimitError) || error.retryAfterSeconds > 120 || wait >= MAX_QUOTA_WAITS) {
        throw error;
      }
    }
    console.error("  provider quota reached; waiting a minute");
    await sleep(60_000);
  }
}

async function run(dataset: EvalDataset, only: string | null) {
  const env = parseOptionalLlmEnv(process.env);
  const mode: EvalMode = env ? "model" : "keywords";
  const test = await createTestDb();
  try {
    const base = createAnalysisDeps(test.db, env, {
      logger: {
        info() {},
        warn: (details, message) => {
          const { jobId: _jobId, ...facts } = details as Record<string, unknown>;
          console.error(`  warning: ${message} ${JSON.stringify(facts)}`);
        },
      },
    });
    const deps: AnalysisDeps = {
      ...base,
      extractor: base.extractor && sharedExtractor(base.extractor),
      // Similarity only nudges the band and isn't measured here, so skip the embedding calls.
      embedder: null,
      today: () => dataset.asOf,
    };
    const users = new Map<string, string>();
    for (const profile of dataset.profiles) {
      const userId = await createAuthUser(test.db);
      await saveProfile(test.db, userId, { content: profile.content, revision: null, confirm: true });
      await savePreferences(test.db, userId, { preferences: profile.preferences, revision: null });
      users.set(profile.id, userId);
    }

    const jobs: JobResult[] = [];
    const pairs: PairResult[] = [];
    for (const job of dataset.jobs.filter((item) => !only || item.id.startsWith(only))) {
      console.error(job.id);
      for (const pair of job.pairs) {
        const userId = users.get(pair.profile) ?? "";
        const { jobId } = await createUserJob(test.db, userId, {
          source: "user_paste",
          description: job.text,
          sourceUrl: null,
          title: null,
          company: null,
        });
        try {
          const metrics = await analyzeWithQuota(test.db, deps, { userId, jobId });
          const loaded = await loadUserJob(test.db, userId, jobId);
          const score = readStoredMatch(loaded?.match ?? null)?.score;
          if (!jobs.some((item) => item.id === job.id) && metrics.extraction) {
            jobs.push({
              id: job.id,
              method: metrics.extraction.method,
              requirements: metrics.extraction.requirements,
              attempts: metrics.extraction.attempts,
              validity: metrics.extraction.validityRate,
              score: scoreExtraction(job, loaded?.requirements ?? []),
            });
          }
          pairs.push({
            job: job.id,
            profile: pair.profile,
            expected: pair.band,
            actual: metrics.band,
            coverage: score?.coreCoverage ?? null,
            gaps: (score?.skills ?? [])
              .filter((skill) => skill.type === "core_skill" && !skill.evidence)
              .map((skill) => skill.skill),
            status: metrics.explanation.status,
            validityRates: metrics.explanation.validityRates,
            explanationError: metrics.explanation.error,
            error: null,
          });
        } catch (error) {
          if (error instanceof RateLimitError) throw error;
          pairs.push({
            job: job.id,
            profile: pair.profile,
            expected: pair.band,
            actual: null,
            coverage: null,
            gaps: [],
            status: "fallback",
            validityRates: [],
            explanationError: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return { mode, model: env ? `${env.LLM_PROVIDER}:${env.LLM_MODEL}` : null, jobs, pairs };
  } finally {
    await test.close();
  }
}

const pct = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const row = (cells: (string | number)[], widths: number[]) =>
  cells.map((cell, index) => String(cell).padEnd(widths[index] ?? 0)).join("  ");

function report(result: Awaited<ReturnType<typeof run>>, summary: EvalSummary) {
  const lines: string[] = [];
  lines.push(
    result.mode === "model"
      ? `Fitwise eval · model ${result.model}`
      : "Fitwise eval · keyword reader (no LLM key set). Model quote validity is not measured in this mode.",
    "",
  );
  const jobWidths = [12, 9, 5, 9, 8, 6, 30];
  lines.push(row(["JOB", "METHOD", "REQS", "VALIDITY", "RECALL", "ELIG", "MISSED SKILLS"], jobWidths));
  for (const job of result.jobs) {
    lines.push(
      row(
        [
          job.id,
          job.method,
          job.requirements,
          pct(job.validity),
          `${job.score.hits}/${job.score.skills}`,
          result.mode === "model" ? `${job.score.eligibilityHits}/${job.score.eligibility}` : "-",
          job.score.missed.join(", ") || "-",
        ],
        jobWidths,
      ),
    );
  }
  lines.push("");
  const pairWidths = [12, 16, 9, 9, 9, 9, 16, 20];
  lines.push(
    row(
      ["JOB", "PROFILE", "EXPECTED", "BAND", "COVERAGE", "STATUS", "QUOTE VALIDITY", "NOTE / CORE GAPS"],
      pairWidths,
    ),
  );
  for (const pair of result.pairs) {
    lines.push(
      row(
        [
          pair.job,
          pair.profile,
          pair.expected,
          pair.actual ?? "-",
          pair.coverage === null ? "-" : pair.coverage.toFixed(2),
          pair.status,
          pair.validityRates.map((rate) => pct(rate)).join(" → ") || "-",
          pair.error ?? pair.explanationError ?? pair.gaps.join(", "),
        ],
        pairWidths,
      ),
    );
  }
  lines.push(
    "",
    `Jobs ${summary.jobs} · pairs ${summary.pairs}`,
    `Extraction quote validity    ${pct(summary.extractionValidity)}`,
    `Skill recall                 ${pct(summary.skillRecall)} (core vs nice-to-have agreement ${pct(summary.skillTypeAgreement)})`,
    `Eligibility recall           ${pct(summary.eligibilityRecall)}`,
    `Explanation quote validity   ${pct(summary.explanationValidity)} final, ${pct(summary.explanationValidityFirst)} first attempt, ${summary.regenerated} regenerated`,
    `Verified explanations        ${pct(summary.verifiedShare)}${summary.providerErrors ? ` (${summary.providerErrors} provider errors)` : ""}`,
    `Band agreement               ${pct(summary.bandExact)} exact, ${pct(summary.bandNear)} within one band (informational)`,
  );
  return lines.join("\n");
}

async function main(argv: string[]) {
  const onlyIndex = argv.indexOf("--only");
  const only = onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? null) : null;
  if (argv.includes("--require-model") && !parseOptionalLlmEnv(process.env)) {
    console.error(
      "FAIL: --require-model is set but no usable LLM key is configured (GEMINI_API_KEY or OPENAI_API_KEY).",
    );
    return 1;
  }
  const dataset = await loadDataset();
  const result = await run(dataset, only);
  const summary = summarize(result.mode, result.jobs, result.pairs);
  console.log(report(result, summary));
  if (argv.includes("--json")) console.log(JSON.stringify(summary));
  const failures = failedGates(summary);
  if (only) {
    console.log("\nPartial run (--only): gates not applied.");
    return 0;
  }
  if (failures.length) {
    console.log(`\nFAIL\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    return 1;
  }
  console.log("\nPASS");
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof RateLimitError ? `Stopped: ${error.message}` : error);
    process.exit(1);
  },
);
