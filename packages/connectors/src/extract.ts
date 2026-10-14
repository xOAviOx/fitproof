import { Readability } from "@mozilla/readability";
import { cleanJobText } from "@repo/core";
import { parseHTML } from "linkedom";
import { z } from "zod";

export type ExtractedJobPage = {
  /** Set only from structured data; page titles are too noisy to trust as a job title. */
  title: string | null;
  company: string | null;
  text: string;
  method: "json_ld" | "readability";
};

type DomNode = {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<DomNode>;
};

const SKIPPED = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
  "IFRAME",
  "BUTTON",
  "FORM",
  "NAV",
]);
const BLOCKS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DD",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "TABLE",
  "TR",
  "UL",
]);

/** Text with one line per block element and "- " before list items, so quotes stay sentence-shaped. */
export function htmlToText(html: string): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const parts: string[] = [];
  const walk = (node: DomNode) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        parts.push((child.textContent ?? "").replace(/\s+/g, " "));
        continue;
      }
      if (child.nodeType !== 1 || SKIPPED.has(child.nodeName)) continue;
      if (child.nodeName === "BR") {
        parts.push("\n");
        continue;
      }
      const block = BLOCKS.has(child.nodeName);
      if (block) parts.push("\n");
      if (child.nodeName === "LI") parts.push("- ");
      if (child.nodeName === "TD" || child.nodeName === "TH") parts.push(" ");
      walk(child);
      if (block) parts.push("\n");
    }
  };
  walk(document.body as unknown as DomNode);
  return cleanJobText(parts.join(""));
}

/** `htmlToText` for API fields that may hold HTML escaped once more, as Greenhouse's `content` does. */
export function htmlFieldToText(html: string): string {
  const unescaped =
    !/<[a-z]/i.test(html) && /&lt;[a-z]/i.test(html)
      ? parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body.textContent
      : html;
  return htmlToText(unescaped);
}

const text = z
  .string()
  .transform((value) => value.trim())
  .catch("");
const named = z
  .union([z.string(), z.object({ name: z.string() }).transform((value) => value.name)])
  .transform((value) => value.trim())
  .catch("");
const place = z
  .object({
    address: z
      .union([
        z.string(),
        z
          .object({
            addressLocality: z.string().optional(),
            addressRegion: z.string().optional(),
            addressCountry: named.optional(),
          })
          .transform((a) =>
            [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(", "),
          ),
      ])
      .optional(),
  })
  .transform((value) => value.address?.trim() ?? "")
  .catch("");
const list = <T extends z.ZodType>(item: T) =>
  z
    .union([z.array(item), item.transform((value) => [value])])
    .catch([] as z.output<T>[])
    .optional();

/** The subset of schema.org JobPosting we read. Anything malformed becomes empty instead of failing. */
const jobPostingSchema = z.object({
  title: text.optional(),
  description: text.optional(),
  hiringOrganization: named.optional(),
  jobLocation: list(place),
  jobLocationType: text.optional(),
  employmentType: list(text),
});

function isJobPosting(value: Record<string, unknown>) {
  const type = value["@type"];
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
}

function findJobPosting(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (isJobPosting(record)) return record;
  return findJobPosting(record["@graph"], depth + 1);
}

function fromJsonLd(document: { querySelectorAll: (selector: string) => ArrayLike<DomNode> }) {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    let data: unknown;
    try {
      data = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const raw = findJobPosting(data);
    if (!raw) continue;
    const posting = jobPostingSchema.parse(raw);
    const body = htmlFieldToText(posting.description ?? "");
    if (!body) continue;
    const locations = [...new Set((posting.jobLocation ?? []).filter(Boolean))];
    const remote = posting.jobLocationType?.toUpperCase() === "TELECOMMUTE";
    const employment = (posting.employmentType ?? []).filter(Boolean);
    const title = posting.title || null;
    const company = posting.hiringOrganization || null;
    const header = [
      title,
      company && `Company: ${company}`,
      locations.length > 0 && `Location: ${locations.join("; ")}`,
      remote && "Remote: yes",
      employment.length > 0 && `Employment type: ${employment.join(", ")}`,
    ].filter((line): line is string => typeof line === "string" && line.length > 0);
    return { title, company, text: cleanJobText([...header, "", body].join("\n")) };
  }
  return null;
}

/** Prefers schema.org JobPosting data, which most ATS pages embed, and falls back to Readability. */
export function extractJobPage(html: string): ExtractedJobPage | null {
  const { document } = parseHTML(html);
  const structured = fromJsonLd(document as unknown as Parameters<typeof fromJsonLd>[0]);
  if (structured) return { ...structured, method: "json_ld" };
  const article = new Readability(document as never, { charThreshold: 200 }).parse();
  if (!article?.content) return null;
  const body = htmlToText(article.content);
  if (!body) return null;
  return {
    title: null,
    company: null,
    text: cleanJobText([article.title?.trim() ?? "", "", body].join("\n")),
    method: "readability",
  };
}
