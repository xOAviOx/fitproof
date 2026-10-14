import { FetchError, type NetworkPolicy, PUBLIC_INTERNET, parseHttpUrl, safeGet } from "../http";
import { robotsRules } from "../robots";

export type SourceErrorCode =
  | "robots"
  | "not_found"
  | "rate_limited"
  | "http_error"
  | "bad_payload"
  | "too_large"
  | "unreachable";

/** Messages name the host and path only: Adzuna's query string carries the API key. */
export class SourceError extends Error {
  constructor(
    public readonly code: SourceErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export type SourceClientOptions = {
  userAgent: string;
  robotsToken: string;
  network?: NetworkPolicy;
  /** Minimum pause between requests to one host; a longer robots.txt Crawl-delay wins. */
  minGapMs?: number;
  /** Per-host overrides of `minGapMs`, for APIs with published rate limits. */
  hostGapMs?: Readonly<Record<string, number>>;
  timeoutMs?: number;
  maxBytes?: number;
  /** Extra attempts after a 429, a 5xx, or a network error. */
  retries?: number;
  /**
   * Hosts used under an API agreement with a registered key. robots.txt addresses crawlers, and
   * these hosts disallow everything there while inviting keyed API use.
   */
  keyedApiHosts?: readonly string[];
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type SourceClient = {
  /** GET and parse JSON. Throws `SourceError`. */
  getJson(url: string): Promise<unknown>;
  /** Requests sent so far, including retries; run stats report it. */
  readonly requests: number;
};

const MAX_RETRY_AFTER_MS = 60_000;

const describe = (url: URL) => `${url.hostname}${url.pathname}`;

export function createSourceClient(options: SourceClientOptions): SourceClient {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const keyed = new Set(options.keyedApiHosts ?? []);
  const nextAllowedAt = new Map<string, number>();
  let requests = 0;

  const robotsOptions = {
    userAgent: options.userAgent,
    token: options.robotsToken,
    network: options.network,
    timeoutMs: 10_000,
    retries: 1,
  };

  async function checkRobots(url: URL): Promise<number> {
    if (keyed.has(url.hostname)) return 0;
    const rules = await robotsRules(url, robotsOptions);
    if (rules.unreadable) {
      throw new SourceError(
        "robots",
        `${url.hostname}/robots.txt couldn't be read, so ${describe(url)} was skipped`,
      );
    }
    if (!rules.allowed) {
      throw new SourceError("robots", `robots.txt disallows ${describe(url)} for automated clients`);
    }
    return rules.crawlDelayMs;
  }

  async function pace(host: string, gapMs: number) {
    const wait = (nextAllowedAt.get(host) ?? 0) - now();
    if (wait > 0) await sleep(wait);
    nextAllowedAt.set(host, now() + gapMs);
  }

  async function attempt(url: URL) {
    try {
      parseHttpUrl(url.toString(), options.network ?? PUBLIC_INTERNET);
      const baseGapMs = options.hostGapMs?.[url.hostname] ?? options.minGapMs ?? 0;
      const gapMs = Math.max(baseGapMs, await checkRobots(url));
      await pace(url.hostname, gapMs);
      requests++;
      return await safeGet(url.toString(), {
        userAgent: options.userAgent,
        accept: "application/json",
        maxBytes: options.maxBytes ?? 25 * 1024 * 1024,
        timeoutMs: options.timeoutMs ?? 90_000,
        network: options.network,
        checkUrl: async (target) => {
          if (target.toString() !== url.toString()) await checkRobots(target);
        },
      });
    } catch (error) {
      if (error instanceof SourceError) throw error;
      if (error instanceof FetchError) {
        if (error.code === "too_large") throw new SourceError("too_large", `${describe(url)} is too large`);
        throw new SourceError("unreachable", `${describe(url)}: ${error.code}`);
      }
      throw error;
    }
  }

  async function getJson(input: string): Promise<unknown> {
    const url = new URL(input);
    const retries = options.retries ?? 2;
    for (let attemptNumber = 0; ; attemptNumber++) {
      let retryAfterMs: number | null = null;
      let failure: SourceError;
      try {
        const response = await attempt(url);
        if (response.status >= 200 && response.status < 300) {
          try {
            return JSON.parse(response.body);
          } catch {
            throw new SourceError("bad_payload", `${describe(url)} did not return JSON`, response.status);
          }
        }
        if (response.status === 404 || response.status === 410) {
          throw new SourceError("not_found", `${describe(url)} returned ${response.status}`, response.status);
        }
        failure = new SourceError(
          response.status === 429 ? "rate_limited" : "http_error",
          `${describe(url)} returned ${response.status}`,
          response.status,
        );
        if (response.status !== 429 && response.status < 500) throw failure;
        retryAfterMs = response.status === 429 ? 5000 * 2 ** attemptNumber : null;
      } catch (error) {
        if (!(error instanceof SourceError) || error.code !== "unreachable") throw error;
        failure = error;
      }
      if (attemptNumber >= retries) throw failure;
      await sleep(Math.min(MAX_RETRY_AFTER_MS, retryAfterMs ?? 2000 * 2 ** attemptNumber));
    }
  }

  return {
    getJson,
    get requests() {
      return requests;
    },
  };
}
