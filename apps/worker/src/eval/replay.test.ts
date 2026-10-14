import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObjectGenerator, ObjectRequest } from "@repo/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { QuotaExhaustedError, quotaWait, replayingGenerator } from "./replay";

const request = (prompt: string): ObjectRequest => ({
  system: "system",
  prompt,
  schema: z.object({ answer: z.string() }),
  maxOutputTokens: 100,
});
const quotaError = (body: string) =>
  Object.assign(new Error("quota"), { statusCode: 429, responseBody: body });
const DAILY = quotaError(
  '{"error":{"code":429,"details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]},{"retryDelay":"20s"}]}}',
);
const MINUTE = quotaError(
  '{"error":{"code":429,"details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"20.5s"}]}}',
);

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "eval-replay-"));
  file = join(dir, "nested", "run.json");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function counting() {
  let calls = 0;
  return vi.fn<ObjectGenerator>(async () => {
    calls++;
    return { object: { answer: `call ${calls}` }, inputTokens: 10, outputTokens: 5 };
  });
}
const open = (generate: ObjectGenerator, extra: { fresh?: boolean; wait?: () => Promise<unknown> } = {}) =>
  replayingGenerator({ file, model: "gemini:test", rpm: 600_000, generate, wait: async () => {}, ...extra });

describe("quotaWait", () => {
  it("tells a spent daily quota from a per-minute one, and ignores other errors", () => {
    expect(quotaWait(DAILY)).toBe("day");
    expect(quotaWait(quotaError('{"error":{"code":"insufficient_quota"}}'))).toBe("day");
    expect(quotaWait(MINUTE)).toBe(21);
    expect(quotaWait(quotaError("{}"))).toBe(60);
    expect(quotaWait(Object.assign(new Error("boom"), { statusCode: 500 }))).toBeNull();
    expect(quotaWait(null)).toBeNull();
  });
});

describe("replayingGenerator", () => {
  it("replays saved responses in a later run, keeping repeated requests distinct", async () => {
    const first = counting();
    const run1 = await open(first);
    expect((await run1.generate(request("a"))).object).toEqual({ answer: "call 1" });
    expect((await run1.generate(request("a"))).object).toEqual({ answer: "call 2" });
    expect(run1.stats).toMatchObject({ live: 2, replayed: 0 });

    const second = counting();
    const run2 = await open(second);
    expect((await run2.generate(request("a"))).object).toEqual({ answer: "call 1" });
    expect((await run2.generate(request("a"))).object).toEqual({ answer: "call 2" });
    expect(second).not.toHaveBeenCalled();
    expect((await run2.generate(request("a"))).object).toEqual({ answer: "call 1" });
    expect(second).toHaveBeenCalledTimes(1);
    expect(run2.stats).toMatchObject({ live: 1, replayed: 2 });
    expect(run2.savedResponses()).toBe(3);
  });

  it("stops on a spent daily quota and resumes from the saved responses", async () => {
    const generate = vi
      .fn<ObjectGenerator>()
      .mockResolvedValueOnce({ object: { answer: "a" }, inputTokens: 1, outputTokens: 1 })
      .mockRejectedValueOnce(DAILY);
    const run1 = await open(generate);
    await run1.generate(request("a"));
    await expect(run1.generate(request("b"))).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(run1.stats.exhausted).toBe(true);
    await expect(run1.generate(request("c"))).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(generate).toHaveBeenCalledTimes(2);

    const resumed = counting();
    const run2 = await open(resumed);
    expect((await run2.generate(request("a"))).object).toEqual({ answer: "a" });
    expect((await run2.generate(request("b"))).object).toEqual({ answer: "call 1" });
    expect(resumed).toHaveBeenCalledTimes(1);
  });

  it("waits out a per-minute quota, then gives up after a few tries", async () => {
    const wait = vi.fn(async () => {});
    const generate = vi
      .fn<ObjectGenerator>()
      .mockRejectedValueOnce(MINUTE)
      .mockResolvedValueOnce({ object: { answer: "ok" }, inputTokens: 1, outputTokens: 1 })
      .mockRejectedValue(MINUTE);
    const run = await open(generate, { wait });
    expect((await run.generate(request("a"))).object).toEqual({ answer: "ok" });
    expect(wait).toHaveBeenCalledWith(21);
    await expect(run.generate(request("b"))).rejects.toBeInstanceOf(QuotaExhaustedError);
    expect(generate).toHaveBeenCalledTimes(6);
  });

  it("passes other errors through without saving anything", async () => {
    const run = await open(vi.fn<ObjectGenerator>().mockRejectedValue(new Error("bad gateway")));
    await expect(run.generate(request("a"))).rejects.toThrow("bad gateway");
    expect(run.stats.exhausted).toBe(false);
    expect(run.savedResponses()).toBe(0);
  });

  it("calls the model again when a saved response no longer fits the schema, or with --fresh", async () => {
    await (await open(counting())).generate(request("a"));
    const changed = counting();
    const run = await open(changed);
    // A refinement isn't part of the JSON schema, so this is the same request with a stricter check.
    const stricter = z.object({ answer: z.string().refine((value) => value === "x") });
    await run.generate({ ...request("a"), schema: stricter });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(run.stats).toMatchObject({ live: 1, replayed: 0 });
    expect(run.savedResponses()).toBe(1);

    const fresh = counting();
    await (await open(fresh, { fresh: true })).generate(request("a"));
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(await readFile(file, "utf8")))).toHaveLength(1);
  });
});
