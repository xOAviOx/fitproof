import { ResumeInputError } from "./resume";

const SECTION =
  /^(?:technical\s+|professional\s+|relevant\s+|work\s+|academic\s+)?(?:skills|experience|employment|internships?|projects?|education|qualifications|certifications?|achievements|coursework)(?:\s*(?:&|and)\s*(?:skills|experience|projects|certifications|training))?\s*:?\s*$/i;
const CONTACT_LABEL =
  /(?:^|\b)(?:name|e-?mail|phone|mobile|contact|address|residence|date of birth|dob|nationality|marital status)\s*[:|]/i;
const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
const URL_PATTERN = /(?:https?:\/\/|www\.|(?:github|linkedin)\.com\/)\S+/gi;
const PHONE = /(?:\+?\d[\d ().-]{7,}\d)/g;
const POSTAL_ADDRESS =
  /\b(?:address|residing|residence|street|road|lane|avenue|apartment|flat|house|sector|pincode|pin code)\b/i;

/**
 * Fail closed without a recognizable section boundary. Headers and contact lines never leave the server.
 * Names learned from the header are also removed if repeated in the body.
 */
export function redactResume(text: string): { text: string; links: { label: string; url: string }[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const boundary = lines.findIndex((line) => SECTION.test(line.trim()));
  if (boundary < 0) {
    throw new ResumeInputError(
      "We couldn't safely separate contact details. Use clear headings such as Skills, Experience, and Education, or build your profile manually.",
    );
  }
  const names = lines.slice(0, boundary).flatMap((line) => {
    const candidate = line.trim().replace(/^name\s*:\s*/i, "");
    const labelled = /^name\s*:/i.test(line.trim());
    return /^[\p{L}][\p{L} .'-]{2,70}$/u.test(candidate) &&
      (labelled || candidate.split(/\s+/).length >= 2) &&
      (labelled || !/\b(?:developer|engineer|analyst|student|intern|scientist|designer)\b/i.test(candidate))
      ? [candidate]
      : [];
  });
  const links = [...text.matchAll(/https?:\/\/[^\s<>)]+/gi)]
    .map(([url]) => ({
      label: /github/i.test(url) ? "GitHub" : /linkedin/i.test(url) ? "LinkedIn" : "Website",
      url,
    }))
    .filter((link, index, all) => all.findIndex((entry) => entry.url === link.url) === index)
    .filter((link) => {
      try {
        return new URL(link.url).hostname.length > 0;
      } catch {
        return false;
      }
    })
    .slice(0, 20);
  let body = lines
    .slice(boundary)
    .filter((line) => !CONTACT_LABEL.test(line) && !POSTAL_ADDRESS.test(line))
    .join("\n")
    .replace(EMAIL, "[email removed]")
    .replace(URL_PATTERN, "[link removed]")
    .replace(PHONE, (match) => (match.replace(/\D/g, "").length >= 10 ? "[phone removed]" : match));
  for (const name of names) {
    body = body.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[name removed]");
  }
  body = body.replace(/\b\d{6}\b/g, "[postal code removed]");
  return { text: body, links };
}
