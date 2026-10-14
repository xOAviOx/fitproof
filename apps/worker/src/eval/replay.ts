import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type ObjectGenerator, strictJsonSchema } from "@repo/llm";
import { z } from "zod";

const savedSchema = z.record(
  z.string(),
  z.array(z.object({ object: z.unknown(), inputTokens: z.number(), outputTokens: z.number() })),
);
type Saved = z.infer<typeof savedSchema>;

export class QuotaExhaustedError extends Error {
  constructor() {
    super("The provider's request quota is used up for now");
    this.name = "QuotaExhaustedError";
  }
}

const MAX_MINUTE_WAITS = 3;

/**
 * Seconds to wait out a 429, or "day" when it won't clear within minutes: Gemini names its per-day
 * quota in the error body, and OpenAI reports an account out of credit as `insufficient_quota`.
 */
export function quotaWait(error: unknown): number | "day" | null {
  const { statusCode, responseBody } = (error ?? {}) as { statusCode?: unknown; responseBody?: unknown };
  if (statusCode !== 429) return null;
  const body = typeof responseBody === "string" ? responseBody : "";
  if (/PerDay|insufficient_quota/.test(body)) return "day";
  const retry = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return Math.min(Math.ceil(Number(retry?.[1] ?? 60)), 120);
}

async function load(file: string): Promise<Saved> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return {};
    throw error;
  }
  const parsed = savedSchema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(`${file} is not a saved eval run; delete it or pass --fresh`);
  return parsed.data;
}

async function persist(file: string, saved: Saved) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(saved));
  await rename(`${file}.tmp`, file);
}

/**
 * Saves every successful model response to `file` and replays it when the same request comes up in
 * a later run, so a run stopped by a daily quota continues where it left off. The nth identical
 * request replays the nth saved response, which keeps regenerations distinct from first attempts.
 * Only live calls are paced to `rpm`.
 */
export async function replayingGenerator(options: {
  file: string;
  model: string;
  rpm: number;
  generate: ObjectGenerator;
  fresh?: boolean;
  wait?: (seconds: number) => Promise<unknown>;
  onWait?: (seconds: number) => void;
}) {
  const saved = options.fresh ? {} : await load(options.file);
  const wait = options.wait ?? ((seconds: number) => sleep(seconds * 1000));
  const used = new Map<string, number>();
  const stats = { replayed: 0, live: 0, exhausted: false };
  let lastLiveAt = Number.NEGATIVE_INFINITY;

  const generate: ObjectGenerator = async (request) => {
    const key = createHash("sha256")
      .update(
        JSON.stringify([
          options.model,
          request.system,
          request.prompt,
          strictJsonSchema(request.schema),
          request.maxOutputTokens,
        ]),
      )
      .digest("hex");
    const occurrence = used.get(key) ?? 0;
    const earlier = saved[key]?.[occurrence];
    const parsed = earlier ? request.schema.safeParse(earlier.object) : null;
    if (earlier && parsed?.success) {
      used.set(key, occurrence + 1);
      stats.replayed++;
      return { ...earlier, object: parsed.data };
    }
    if (stats.exhausted) throw new QuotaExhaustedError();
    for (let waits = 0; ; waits++) {
      const gap = (lastLiveAt + 60_000 / options.rpm - Date.now()) / 1000;
      if (gap > 0) await wait(gap);
      lastLiveAt = Date.now();
      try {
        const result = await options.generate(request);
        const list = saved[key] ?? [];
        list[occurrence] = {
          object: result.object,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        };
        saved[key] = list;
        await persist(options.file, saved);
        used.set(key, occurrence + 1);
        stats.live++;
        return result;
      } catch (error) {
        const quota = quotaWait(error);
        if (quota === null) throw error;
        if (quota === "day" || waits >= MAX_MINUTE_WAITS) {
          stats.exhausted = true;
          throw new QuotaExhaustedError();
        }
        options.onWait?.(quota);
        await wait(quota);
      }
    }
  };

  return {
    generate,
    stats,
    savedResponses: () => Object.values(saved).reduce((sum, list) => sum + list.length, 0),
  };
}
