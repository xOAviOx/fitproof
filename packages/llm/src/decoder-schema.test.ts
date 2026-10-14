import { explanationOutputSchema, jobExtractionSchema, profileContentSchema } from "@repo/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decoderJsonSchema, fitToSchema, strictJsonSchema } from "./decoder-schema";

const LIMITS = [
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "pattern",
  "format",
];

/** Every keyword used as a schema keyword (not as a property name) anywhere in the tree. */
function keywords(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) keywords(item, found);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      found.add(key);
      if (key === "properties" && value && typeof value === "object") {
        for (const child of Object.values(value)) keywords(child, found);
      } else {
        keywords(value, found);
      }
    }
  }
  return found;
}

describe("decoderJsonSchema", () => {
  it.each([
    ["job extraction", jobExtractionSchema],
    ["explanation", explanationOutputSchema],
    ["profile", profileContentSchema],
  ])("drops every size and range limit from the %s schema, and nothing else", (_name, schema) => {
    const strict = strictJsonSchema(schema);
    const relaxed = decoderJsonSchema(strict);
    const used = keywords(relaxed);
    for (const limit of LIMITS) expect(used.has(limit)).toBe(false);
    expect(keywords(strict).has("maxLength")).toBe(true);
    for (const kept of keywords(strict)) {
      if (!LIMITS.includes(kept)) expect(used.has(kept), kept).toBe(true);
    }
  });

  it("keeps properties whose names look like keywords", () => {
    const relaxed = decoderJsonSchema(
      strictJsonSchema(z.object({ format: z.string().max(5), maxItems: z.number().max(3) })),
    );
    expect(Object.keys(relaxed.properties as object)).toEqual(["format", "maxItems"]);
    expect(relaxed.additionalProperties).toBe(false);
  });
});

describe("fitToSchema", () => {
  it("trims long strings and lists so the strict schema accepts the response", () => {
    const gap = { requirement: "R1", jobQuote: "Docker", note: "x".repeat(700) };
    const output = {
      summary: "Fine.",
      strengths: [],
      gaps: Array.from({ length: 31 }, () => gap),
      checks: [],
    };
    expect(explanationOutputSchema.safeParse(output).success).toBe(false);

    const fitted = explanationOutputSchema.parse(
      fitToSchema(output, strictJsonSchema(explanationOutputSchema)),
    );
    expect(fitted.gaps).toHaveLength(30);
    expect(fitted.gaps[0]?.note).toHaveLength(600);
  });

  it("follows nullable branches and leaves type errors for the schema to reject", () => {
    const strict = strictJsonSchema(jobExtractionSchema);
    const requirement = {
      type: "hard_eligibility",
      text: "Bengaluru only",
      quote: "Must be based in Bengaluru.",
      skill: null,
      eligibility: {
        kind: "location",
        cities: Array.from({ length: 25 }, (_, i) => `City ${i}`),
        relocationAccepted: null,
        country: null,
        sponsorshipAvailable: null,
        degreeLevels: null,
        degrees: null,
        fields: null,
        allowRelated: null,
        minScores: null,
        graduationYears: null,
        minYears: null,
        maxYears: null,
        joinWithinDays: null,
        startBy: null,
      },
    };
    const raw = {
      title: "t".repeat(400),
      company: null,
      locations: [],
      remoteType: "onsite",
      employmentType: "full_time",
      seniority: "entry",
      roleFamily: null,
      salary: null,
      requirements: [requirement],
    };
    const fitted = jobExtractionSchema.parse(fitToSchema(raw, strict));
    expect(fitted.title).toHaveLength(300);
    expect(fitted.requirements[0]?.eligibility?.cities).toHaveLength(20);

    expect(jobExtractionSchema.safeParse(fitToSchema({ ...raw, remoteType: "moon" }, strict)).success).toBe(
      false,
    );
  });
});
