import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NetworkPolicy } from "../http";
import { clearRobotsCache } from "../robots";
import { createSourceClient, SourceError } from "./client";

const LOCAL: NetworkPolicy = { allowAddress: () => true, allowPort: () => true };

let server: Server;
let port = 0;
let robots = "User-agent: *\nAllow: /\n";
let flaky = 0;
let robotsFailures = 0;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    hits.push(path);
    const json = (status: number, body: string) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(body);
    };
    if (path === "/robots.txt") {
      if (robotsFailures-- > 0) return json(503, "");
      response.writeHead(200, { "Content-Type": "text/plain" });
      return response.end(robots);
    }
    if (path.startsWith("/ok")) return json(200, '{"jobs":[]}');
    if (path === "/flaky") return flaky-- > 0 ? json(503, "{}") : json(200, '{"ok":true}');
    if (path === "/limited") return json(429, "{}");
    if (path === "/gone") return json(404, '{"error":"not found"}');
    if (path === "/forbidden") return json(403, "{}");
    if (path === "/html") return json(200, "<html>");
    if (path === "/private") return json(200, '{"private":true}');
    return json(500, "{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  clearRobotsCache();
  robots = "User-agent: *\nAllow: /\n";
  flaky = 0;
  robotsFailures = 0;
  hits.length = 0;
});

function client(overrides: Partial<Parameters<typeof createSourceClient>[0]> = {}) {
  const waits: number[] = [];
  let clock = 1_000_000;
  const instance = createSourceClient({
    userAgent: "FitwiseBot/0.4 (+https://fitwise.example/bot)",
    robotsToken: "FitwiseBot",
    network: LOCAL,
    timeoutMs: 3000,
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
    ...overrides,
  });
  return { instance, waits };
}

const url = (path: string, host = "127.0.0.1") => `http://${host}:${port}${path}`;

describe("source client", () => {
  it("parses JSON and paces requests to one host by the larger of its gap and Crawl-delay", async () => {
    robots = "User-agent: *\nCrawl-delay: 2\nAllow: /\n";
    const { instance, waits } = client({ minGapMs: 400 });
    expect(await instance.getJson(url("/ok/1"))).toEqual({ jobs: [] });
    await instance.getJson(url("/ok/2"));
    expect(waits).toEqual([2000]);
    expect(instance.requests).toBe(2);

    robots = "User-agent: *\nAllow: /\n";
    const slow = client({ minGapMs: 400, hostGapMs: { localhost: 3000 } });
    await slow.instance.getJson(url("/ok/1", "localhost"));
    await slow.instance.getJson(url("/ok/2", "localhost"));
    expect(slow.waits).toEqual([3000]);
  });

  it("retries an unreadable robots.txt once, then skips the host and says why", async () => {
    robotsFailures = 1;
    const { instance } = client();
    await expect(instance.getJson(url("/ok"))).resolves.toEqual({ jobs: [] });
    expect(hits).toEqual(["/robots.txt", "/robots.txt", "/ok"]);

    clearRobotsCache();
    robotsFailures = 5;
    hits.length = 0;
    const failure = await instance.getJson(url("/ok")).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "robots", message: expect.stringContaining("couldn't be read") });
    expect(hits).toEqual(["/robots.txt", "/robots.txt"]);
  });

  it("refuses paths robots.txt disallows, but not hosts used with an API key", async () => {
    robots = "User-agent: *\nDisallow: /\n";
    const { instance } = client();
    await expect(instance.getJson(url("/ok"))).rejects.toMatchObject({ code: "robots" });
    expect(hits).toEqual(["/robots.txt"]);
    const keyed = client({ keyedApiHosts: ["127.0.0.1"] }).instance;
    expect(await keyed.getJson(url("/ok"))).toEqual({ jobs: [] });
  });

  it("retries 5xx responses with backoff, and gives up after the retry budget", async () => {
    flaky = 2;
    const { instance, waits } = client();
    expect(await instance.getJson(url("/flaky"))).toEqual({ ok: true });
    expect(waits).toEqual([2000, 4000]);

    const limited = client({ retries: 1 });
    await expect(limited.instance.getJson(url("/limited"))).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect(limited.waits).toEqual([5000]);
  });

  it("does not retry missing or forbidden resources, or non-JSON bodies", async () => {
    const { instance, waits } = client();
    await expect(instance.getJson(url("/gone"))).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(instance.getJson(url("/forbidden"))).rejects.toMatchObject({
      code: "http_error",
      status: 403,
    });
    await expect(instance.getJson(url("/html"))).rejects.toMatchObject({ code: "bad_payload" });
    expect(waits).toEqual([]);
  });

  it("never puts the query string, where Adzuna's key goes, in an error message", async () => {
    const { instance } = client({ retries: 0 });
    const error: unknown = await instance
      .getJson(url("/limited?app_key=secret-key"))
      .catch((caught) => caught);
    if (!(error instanceof SourceError)) throw new Error("expected a SourceError");
    expect(error.message).not.toContain("secret-key");
    expect(error.message).toContain("/limited");
  });

  it("blocks private addresses and custom ports under the default network policy", async () => {
    const strict = createSourceClient({ userAgent: "FitwiseBot/0.4", robotsToken: "FitwiseBot", retries: 0 });
    await expect(strict.getJson("http://127.0.0.1/private")).rejects.toMatchObject({ code: "unreachable" });
    await expect(strict.getJson(url("/private"))).rejects.toMatchObject({ code: "unreachable" });
    expect(hits).toEqual([]);
  });
});
