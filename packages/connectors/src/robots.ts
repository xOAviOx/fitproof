import robotsParser from "robots-parser";
import { FetchError, type NetworkPolicy, safeGet } from "./http";

type Rules = { allows: (url: string) => boolean; expiresAt: number };

const TTL_MS = 60 * 60_000;
const UNREACHABLE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;
const cache = new Map<string, Rules>();

const allowAll: Rules["allows"] = () => true;
const disallowAll: Rules["allows"] = () => false;

/**
 * RFC 9309: a 4xx robots.txt means no rules apply; a 5xx or unreachable robots.txt means
 * everything is disallowed. Rules are cached per origin for an hour.
 */
export async function robotsAllow(
  url: URL,
  options: { userAgent: string; token: string; network?: NetworkPolicy; timeoutMs?: number },
): Promise<boolean> {
  const cached = cache.get(url.origin);
  if (cached && cached.expiresAt > Date.now()) return cached.allows(url.toString());
  const robotsUrl = new URL("/robots.txt", url.origin).toString();
  let allows = disallowAll;
  let ttl = UNREACHABLE_TTL_MS;
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
      allows = (target) => robots.isAllowed(target, options.token) ?? true;
      ttl = TTL_MS;
    } else if (response.status >= 400 && response.status < 500) {
      allows = allowAll;
      ttl = TTL_MS;
    }
  } catch (error) {
    if (error instanceof FetchError && error.code === "private_address") throw error;
  }
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value ?? "");
  cache.set(url.origin, { allows, expiresAt: Date.now() + ttl });
  return allows(url.toString());
}

export function clearRobotsCache() {
  cache.clear();
}
