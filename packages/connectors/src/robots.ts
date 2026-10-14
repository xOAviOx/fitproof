import robotsParser from "robots-parser";
import { FetchError, type NetworkPolicy, safeGet } from "./http";

type Rules = {
  allows: (url: string) => boolean;
  crawlDelayMs: number;
  unreadable: boolean;
  expiresAt: number;
};

const TTL_MS = 60 * 60_000;
const UNREACHABLE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
/** A larger Crawl-delay would stall a whole run; such a site can be paused in the registry instead. */
const MAX_CRAWL_DELAY_MS = 10_000;
const cache = new Map<string, Rules>();

const allowAll: Rules["allows"] = () => true;
const disallowAll: Rules["allows"] = () => false;

/**
 * RFC 9309: a 4xx robots.txt means no rules apply; a 5xx or unreachable robots.txt means
 * everything is disallowed. Rules are cached per origin for an hour.
 */
export async function robotsAllow(url: URL, options: RobotsOptions): Promise<boolean> {
  return (await robotsRules(url, options)).allowed;
}

type RobotsOptions = {
  userAgent: string;
  token: string;
  network?: NetworkPolicy;
  timeoutMs?: number;
  /** Extra attempts when robots.txt is unreachable or answers 5xx, one second apart. */
  retries?: number;
};

export type RobotsDecision = {
  allowed: boolean;
  /** The Crawl-delay the site asks of the token (0 when none). */
  crawlDelayMs: number;
  /** robots.txt couldn't be read, so everything is disallowed for a few minutes. */
  unreadable: boolean;
};

async function readRules(
  robotsUrl: string,
  options: RobotsOptions,
): Promise<Omit<Rules, "expiresAt"> & { ttl: number }> {
  try {
    const response = await safeGet(robotsUrl, {
      userAgent: options.userAgent,
      accept: "text/plain,*/*;q=0.5",
      maxBytes: 512 * 1024,
      timeoutMs: options.timeoutMs ?? 5000,
      network: options.network,
    });
    if (response.status >= 200 && response.status < 300) {
      const robots = robotsParser(robotsUrl, response.body);
      return {
        allows: (target) => robots.isAllowed(target, options.token) ?? true,
        crawlDelayMs: Math.min(MAX_CRAWL_DELAY_MS, (robots.getCrawlDelay(options.token) ?? 0) * 1000),
        unreadable: false,
        ttl: TTL_MS,
      };
    }
    if (response.status >= 400 && response.status < 500) {
      return { allows: allowAll, crawlDelayMs: 0, unreadable: false, ttl: TTL_MS };
    }
  } catch (error) {
    if (error instanceof FetchError && error.code === "private_address") throw error;
  }
  return { allows: disallowAll, crawlDelayMs: 0, unreadable: true, ttl: UNREACHABLE_TTL_MS };
}

/** Whether the URL may be fetched under the site's robots.txt, and the Crawl-delay it asks for. */
export async function robotsRules(url: URL, options: RobotsOptions): Promise<RobotsDecision> {
  const cached = cache.get(url.origin);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      allowed: cached.allows(url.toString()),
      crawlDelayMs: cached.crawlDelayMs,
      unreadable: cached.unreadable,
    };
  }
  const robotsUrl = new URL("/robots.txt", url.origin).toString();
  let rules = await readRules(robotsUrl, options);
  for (let attempt = 0; rules.unreadable && attempt < (options.retries ?? 0); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    rules = await readRules(robotsUrl, options);
  }
  const { ttl, ...entry } = rules;
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value ?? "");
  cache.set(url.origin, { ...entry, expiresAt: Date.now() + ttl });
  return {
    allowed: entry.allows(url.toString()),
    crawlDelayMs: entry.crawlDelayMs,
    unreadable: entry.unreadable,
  };
}

export function clearRobotsCache() {
  cache.clear();
}
