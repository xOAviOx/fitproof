import type { JobExtraction } from "./jobs";
import { findSkills, skillLabel } from "./skills";

const OPTIONAL =
  /\b(nice to have|good to have|preferred|preferably|is a plus|are a plus|a plus|bonus|added advantage|desirable)\b/i;
/** A short line without sentence punctuation, such as "Requirements" or "Nice to have:". */
const HEADING = /^[\p{L}\s'’&/()-]{2,60}:?$/u;
const BULLET = /^[-*•·▪◦‣]\s*/u;
const MAX_REQUIREMENTS = 40;

/**
 * Reads a posting without a model, for when no LLM provider is configured. Every known skill becomes
 * a requirement quoted by the line (or sentence) that names it. It never reads eligibility,
 * responsibilities, or skills outside the vocabulary, so it can't exclude a job.
 */
export function keywordJobExtraction(text: string): JobExtraction {
  const requirements: JobExtraction["requirements"] = [];
  const seen = new Set<string>();
  let optionalSection = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(BULLET, "").trim();
    if (!line) continue;
    const segments = line.length > 300 ? line.split(/(?<=[.!?;])\s+/) : [line];
    if (segments.length === 1 && HEADING.test(line) && findSkills(line).length === 0) {
      optionalSection = OPTIONAL.test(line);
      continue;
    }
    for (const segment of segments) {
      // "React; Next.js is a plus" makes only Next.js optional, so judge wording per clause.
      const clauses = segment.split(/[;!?]|\.(?=\s)/);
      for (const key of findSkills(segment)) {
        if (seen.has(key) || requirements.length >= MAX_REQUIREMENTS) continue;
        seen.add(key);
        const clause = clauses.find((part) => findSkills(part).includes(key)) ?? segment;
        requirements.push({
          type: optionalSection || OPTIONAL.test(clause) ? "nice_to_have" : "core_skill",
          text: skillLabel(key, key),
          quote: segment.slice(0, 1000),
          skill: key,
          eligibility: null,
        });
      }
    }
  }
  return {
    title: null,
    company: null,
    locations: [],
    remoteType: "unknown",
    employmentType: "unknown",
    seniority: "unknown",
    roleFamily: null,
    salary: null,
    requirements,
  };
}
