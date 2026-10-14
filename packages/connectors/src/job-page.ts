import { MAX_JOB_CHARACTERS, MIN_JOB_CHARACTERS } from "@repo/core";
import { type ExtractedJobPage, extractJobPage } from "./extract";
import { FetchError, type NetworkPolicy, safeGet } from "./http";
import { robotsAllow } from "./robots";

/** Sites whose terms prohibit automated access. Users paste these descriptions instead. */
const BLOCKED_SITES: { domain: string; name: string }[] = [
  { domain: "linkedin.com", name: "LinkedIn" },
  { domain: "lnkd.in", name: "LinkedIn" },
  { domain: "naukri.com", name: "Naukri" },
  { domain: "indeed.com", name: "Indeed" },
  { domain: "glassdoor.com", name: "Glassdoor" },
  { domain: "glassdoor.co.in", name: "Glassdoor" },
  { domain: "foundit.in", name: "foundit" },
  { domain: "monsterindia.com", name: "foundit" },
];

export function blockedSite(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return BLOCKED_SITES.find(({ domain }) => host === domain || host.endsWith(`.${domain}`))?.name ?? null;
}

export type JobPageErrorCode =
  | "invalid_url"
  | "blocked_site"
  | "private_address"
  | "robots"
  | "not_found"
  | "http_error"
  | "unsupported"
  | "too_large"
  | "unreachable"
  | "no_description";

const PASTE = "Copy the job description from the page and paste it instead.";

/** `message` is safe to show to the user. */
export class JobPageError extends Error {
  constructor(
    public readonly code: JobPageErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: JobPageErrorCode, message: string) => new JobPageError(code, message);

export type JobPageOptions = {
  /** Full User-Agent header, e.g. "FitwiseBot/0.3 (+https://example.com/bot)". */
  userAgent: string;
  /** Product token matched against robots.txt groups. */
  robotsToken: string;
  network?: NetworkPolicy;
  timeoutMs?: number;
};
export type JobPage = ExtractedJobPage & { url: string };

/** Fetches one user-supplied job link. Never retried automatically: the user can paste instead. */
export async function fetchJobPage(input: string, options: JobPageOptions): Promise<JobPage> {
  const checkUrl = async (url: URL) => {
    const site = blockedSite(url.hostname);
    if (site) {
      throw fail("blocked_site", `${site} doesn't allow automated access to its job pages. ${PASTE}`);
    }
    const allowed = await robotsAllow(url, {
      userAgent: options.userAgent,
      token: options.robotsToken,
      network: options.network,
    });
    if (!allowed) throw fail("robots", `This site asks automated tools not to read that page. ${PASTE}`);
  };
  try {
    const response = await safeGet(input, {
      userAgent: options.userAgent,
      accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.5",
      maxBytes: 3 * 1024 * 1024,
      timeoutMs: options.timeoutMs ?? 10_000,
      network: options.network,
      checkUrl,
    });
    if (response.status === 404 || response.status === 410) {
      throw fail(
        "not_found",
        `That page wasn't found. The job may have closed. Check the link, or ${lower(PASTE)}`,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      throw fail("http_error", `The site returned an error (${response.status}). ${PASTE}`);
    }
    const plain = response.contentType.startsWith("text/plain");
    if (!plain && !/html|xml/.test(response.contentType)) {
      throw fail("unsupported", `That link isn't a web page we can read. ${PASTE}`);
    }
    const page: ExtractedJobPage | null = plain
      ? { title: null, company: null, text: response.body, method: "readability" }
      : extractJobPage(response.body);
    if (!page || page.text.length < MIN_JOB_CHARACTERS) {
      throw fail("no_description", `We couldn't find a job description on that page. ${PASTE}`);
    }
    return { ...page, text: page.text.slice(0, MAX_JOB_CHARACTERS), url: response.url };
  } catch (error) {
    if (error instanceof JobPageError) throw error;
    if (error instanceof FetchError) throw fromFetchError(error);
    throw error;
  }
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function fromFetchError(error: FetchError): JobPageError {
  switch (error.code) {
    case "invalid_url":
      return fail("invalid_url", "Enter a public job link starting with https://, without a port or login.");
    case "private_address":
      return fail("private_address", "That link points to a private network address. Use a public job link.");
    case "too_large":
      return fail("too_large", `That page is too large to read. ${PASTE}`);
    case "too_many_redirects":
      return fail("unreachable", `That link redirects too many times. ${PASTE}`);
    case "timeout":
    case "network":
      return fail("unreachable", `We couldn't reach that page. ${PASTE}`);
  }
}
