import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isPublicAddress, type NetworkPolicy } from "./http";
import { blockedSite, fetchJobPage, JobPageError } from "./job-page";
import { clearRobotsCache } from "./robots";

const USER_AGENT = "FitwiseBot/0.3 (+https://fitwise.example/bot)";
const LOCAL: NetworkPolicy = { allowAddress: () => true, allowPort: () => true };
const options = { userAgent: USER_AGENT, robotsToken: "FitwiseBot", network: LOCAL, timeoutMs: 3000 };

const JOB_HTML = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "JobPosting",
  title: "Frontend Engineer",
  hiringOrganization: "Acme",
  description: `<p>${"Build accessible React interfaces with TypeScript. ".repeat(8)}</p>`,
})}</script></head><body></body></html>`;

let server: Server;
let base = "";
let robots: { status: number; body: string } = { status: 200, body: "" };
const seen: { path: string; headers: IncomingHttpHeaders }[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    seen.push({ path, headers: request.headers });
    const html = (body: string, extra: Record<string, string> = {}) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...extra });
      response.end(body);
    };
    switch (path) {
      case "/robots.txt":
        response.writeHead(robots.status, { "Content-Type": "text/plain" });
        return response.end(robots.body);
      case "/job":
        return html(JOB_HTML);
      case "/gzip":
        response.writeHead(200, { "Content-Type": "text/html", "Content-Encoding": "gzip" });
        return response.end(gzipSync(JOB_HTML));
      case "/redirect":
        response.writeHead(302, { Location: "/job" });
        return response.end();
      case "/loop":
        response.writeHead(302, { Location: "/loop" });
        return response.end();
      case "/to-linkedin":
        response.writeHead(301, { Location: "https://in.linkedin.com/jobs/view/123" });
        return response.end();
      case "/missing":
        response.writeHead(404, { "Content-Type": "text/html" });
        return response.end("Not found");
      case "/pdf":
        response.writeHead(200, { "Content-Type": "application/pdf" });
        return response.end("%PDF-1.7");
      case "/big":
        response.writeHead(200, { "Content-Type": "text/html" });
        for (let i = 0; i < 40; i++) response.write("x".repeat(100_000));
        return response.end();
      case "/thin":
        return html("<html><body><p>Apply now.</p></body></html>");
      default:
        return html(JOB_HTML);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  clearRobotsCache();
  robots = { status: 200, body: "User-agent: *\nDisallow: /private\n" };
  seen.length = 0;
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof JobPageError) return error.code;
    throw error;
  }
  throw new Error("Expected the fetch to fail");
};

describe("fetchJobPage", () => {
  it("fetches, identifies itself, and extracts the posting", async () => {
    const page = await fetchJobPage(`${base}/job`, options);
    expect(page).toMatchObject({
      title: "Frontend Engineer",
      company: "Acme",
      method: "json_ld",
      url: `${base}/job`,
    });
    expect(page.text).toContain("Build accessible React interfaces with TypeScript.");
    expect(seen.map((entry) => entry.path)).toEqual(["/robots.txt", "/job"]);
    expect(seen.every((entry) => entry.headers["user-agent"] === USER_AGENT)).toBe(true);
  });

  it("decompresses responses and follows redirects", async () => {
    expect((await fetchJobPage(`${base}/gzip`, options)).title).toBe("Frontend Engineer");
    expect((await fetchJobPage(`${base}/redirect`, options)).url).toBe(`${base}/job`);
    expect(await failure(fetchJobPage(`${base}/loop`, options))).toBe("unreachable");
  });

  it("honors robots.txt, treating server errors as disallow and 4xx as no rules", async () => {
    expect(await failure(fetchJobPage(`${base}/private/job`, options))).toBe("robots");
    clearRobotsCache();
    robots = { status: 503, body: "" };
    expect(await failure(fetchJobPage(`${base}/job`, options))).toBe("robots");
    clearRobotsCache();
    robots = { status: 404, body: "" };
    expect((await fetchJobPage(`${base}/job`, options)).title).toBe("Frontend Engineer");
  });

  it("uses the group for its own product token", async () => {
    robots = { status: 200, body: "User-agent: *\nAllow: /\n\nUser-agent: FitwiseBot\nDisallow: /\n" };
    expect(await failure(fetchJobPage(`${base}/job`, options))).toBe("robots");
  });

  it("refuses blocked sites, even after a redirect", async () => {
    expect(await failure(fetchJobPage(`${base}/to-linkedin`, options))).toBe("blocked_site");
    expect(await failure(fetchJobPage("https://www.naukri.com/job-listings-123", options))).toBe(
      "blocked_site",
    );
  });

  it("explains pages it can't use", async () => {
    expect(await failure(fetchJobPage(`${base}/missing`, options))).toBe("not_found");
    expect(await failure(fetchJobPage(`${base}/pdf`, options))).toBe("unsupported");
    expect(await failure(fetchJobPage(`${base}/big`, options))).toBe("too_large");
    expect(await failure(fetchJobPage(`${base}/thin`, options))).toBe("no_description");
  });
});

describe("network policy", () => {
  const strict = { userAgent: USER_AGENT, robotsToken: "FitwiseBot", timeoutMs: 3000 };

  it("blocks private, loopback, and metadata addresses by default", async () => {
    expect(await failure(fetchJobPage("http://127.0.0.1/job", strict))).toBe("private_address");
    expect(await failure(fetchJobPage("http://169.254.169.254/latest/meta-data", strict))).toBe(
      "private_address",
    );
    expect(await failure(fetchJobPage("http://[::1]/job", strict))).toBe("private_address");
    expect(await failure(fetchJobPage("http://localhost/job", strict))).toBe("private_address");
  });

  it("allows only plain http(s) links on default ports", async () => {
    expect(await failure(fetchJobPage(`${base}/job`, strict))).toBe("invalid_url");
    expect(await failure(fetchJobPage("https://user:secret@example.com/job", strict))).toBe("invalid_url");
    expect(await failure(fetchJobPage("ftp://example.com/job", strict))).toBe("invalid_url");
    expect(await failure(fetchJobPage("not a url", strict))).toBe("invalid_url");
  });

  it("classifies addresses", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0"]) {
      expect(isPublicAddress(address, 4)).toBe(false);
    }
    for (const address of ["::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::a00:1"]) {
      expect(isPublicAddress(address, 6)).toBe(false);
    }
    expect(isPublicAddress("8.8.8.8", 4)).toBe(true);
    expect(isPublicAddress("::ffff:8.8.8.8", 6)).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111", 6)).toBe(true);
  });

  it("matches blocked domains and their subdomains only", () => {
    expect(blockedSite("www.linkedin.com")).toBe("LinkedIn");
    expect(blockedSite("lnkd.in")).toBe("LinkedIn");
    expect(blockedSite("NAUKRI.COM.")).toBe("Naukri");
    expect(blockedSite("notlinkedin.com")).toBeNull();
    expect(blockedSite("boards.greenhouse.io")).toBeNull();
  });
});
