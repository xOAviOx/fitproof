import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import type { Readable } from "node:stream";
import zlib from "node:zlib";

export type FetchErrorCode =
  | "invalid_url"
  | "private_address"
  | "timeout"
  | "network"
  | "too_large"
  | "too_many_redirects";

export class FetchError extends Error {
  constructor(
    public readonly code: FetchErrorCode,
    message: string = code,
  ) {
    super(message);
  }
}

/** Which destinations a request may reach. Tests loosen this to talk to a local server. */
export type NetworkPolicy = {
  allowAddress: (address: string, family: 4 | 6) => boolean;
  allowPort: (port: string) => boolean;
};

const PRIVATE_RANGES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 127],
  // NAT64 and 6to4 addresses can embed a private IPv4 address. IPv4-mapped addresses
  // (::ffff:a.b.c.d) need no rule: BlockList checks them against the IPv4 ranges.
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  PRIVATE_RANGES.addSubnet(network, prefix, "ipv6");
}

export const isPublicAddress = (address: string, family: 4 | 6) =>
  !PRIVATE_RANGES.check(address, family === 6 ? "ipv6" : "ipv4");

/** Public internet only, on the default HTTP and HTTPS ports. */
export const PUBLIC_INTERNET: NetworkPolicy = {
  allowAddress: isPublicAddress,
  allowPort: (port) => port === "",
};

const privateAddress = () => new FetchError("private_address");

function guardedLookup(policy: NetworkPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "", 0);
      const list = addresses as LookupAddress[];
      if (!list.length || list.some((entry) => !policy.allowAddress(entry.address, entry.family as 4 | 6))) {
        return callback(privateAddress(), "", 0);
      }
      if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      const [first] = list as [LookupAddress];
      callback(null, first.address, first.family);
    });
  };
}

export function parseHttpUrl(input: string, policy: NetworkPolicy): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new FetchError("invalid_url");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new FetchError("invalid_url");
  }
  if (!policy.allowPort(url.port)) throw new FetchError("invalid_url");
  // Node skips DNS lookup for IP literals, so they are checked here instead.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  if (family && !policy.allowAddress(host, family as 4 | 6)) throw privateAddress();
  return url;
}

export type FetchOptions = {
  userAgent: string;
  accept: string;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  network?: NetworkPolicy;
  /** Runs for the first URL and every redirect target before connecting. Throw to stop. */
  checkUrl?: (url: URL) => Promise<void> | void;
};
export type FetchResponse = { url: string; status: number; contentType: string; body: string };

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** GET with SSRF protection, manual redirects, a deadline, and a decompressed-size cap. */
export async function safeGet(input: string, options: FetchOptions): Promise<FetchResponse> {
  const network = options.network ?? PUBLIC_INTERNET;
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = parseHttpUrl(input, network);
  for (let hop = 0; ; hop++) {
    await options.checkUrl?.(url);
    const response = await open(url, options, network, signal);
    const location = response.headers.location;
    if (REDIRECTS.has(response.statusCode ?? 0) && location) {
      response.resume();
      if (hop >= (options.maxRedirects ?? 5)) throw new FetchError("too_many_redirects");
      url = parseHttpUrl(new URL(location, url).toString(), network);
      continue;
    }
    const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
    const bytes = await readBody(response, options.maxBytes, signal);
    return {
      url: url.toString(),
      status: response.statusCode ?? 0,
      contentType,
      body: decode(bytes, contentType),
    };
  }
}

function open(url: URL, options: FetchOptions, network: NetworkPolicy, signal: AbortSignal) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(url, {
      headers: {
        "User-Agent": options.userAgent,
        Accept: options.accept,
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      lookup: guardedLookup(network),
      signal,
      agent: false,
    });
    request.on("response", resolve);
    request.on("error", (error) => reject(toFetchError(error, signal)));
  });
}

function toFetchError(error: unknown, signal: AbortSignal): FetchError {
  if (error instanceof FetchError) return error;
  if (signal.aborted) return new FetchError("timeout");
  return new FetchError("network", error instanceof Error ? error.message : String(error));
}

async function readBody(response: IncomingMessage, maxBytes: number, signal: AbortSignal) {
  const declared = Number(response.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    response.destroy();
    throw new FetchError("too_large");
  }
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  const stream: Readable =
    encoding === "gzip" || encoding === "x-gzip"
      ? response.pipe(zlib.createGunzip())
      : encoding === "deflate"
        ? response.pipe(zlib.createInflate())
        : encoding === "br"
          ? response.pipe(zlib.createBrotliDecompress())
          : response;
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > maxBytes) throw new FetchError("too_large");
      chunks.push(bytes);
    }
  } catch (error) {
    response.destroy();
    throw toFetchError(error, signal);
  }
  return Buffer.concat(chunks);
}

function decode(bytes: Buffer, contentType: string): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(bytes.subarray(0, 4096).toString("latin1"))?.[1];
  try {
    return new TextDecoder(declared ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
