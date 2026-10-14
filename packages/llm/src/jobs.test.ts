import {
  EMBEDDING_DIMENSIONS,
  type ExplanationOutput,
  type JobExtraction,
  verifyExplanation,
} from "@repo/core";
import { createAuthUser, createTestDb, type TestDb } from "@repo/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createEmbedder,
  createJobExtractor,
  createMatchExplainer,
  llmEnvSchema,
  type ObjectRequest,
} from "./index";

let test: TestDb;
beforeAll(async () => {
  test = await createTestDb();
}, 30_000);
afterAll(async () => {
  await test.close();
});
const env = llmEnvSchema.parse({ GEMINI_API_KEY: "synthetic-test-key", LLM_RPM: 100 });

const POSTING =
  "Backend Engineer\nMust know Node.js.\nKafka is a plus.\nContact hiring@acme.example or +91 98765 43210.";
const extraction = (quotes: string[]): JobExtraction => ({
  title: "Backend Engineer",
  company: null,
  locations: [],
  remoteType: "unknown",
  employmentType: "unknown",
  seniority: "unknown",
  roleFamily: "backend",
  salary: null,
  requirements: quotes.map((quote) => ({
    type: "core_skill",
    text: "Node.js",
    quote,
    skill: "Node.js",
    eligibility: null,
  })),
});
const reply = (object: unknown) => ({ object, inputTokens: 10, outputTokens: 20 });

describe("job extraction", () => {
  it("never sends contact details and verifies quotes against what the model saw", async () => {
    const user = await createAuthUser(test.db);
    const generate = vi.fn(async (_request: ObjectRequest) => reply(extraction(["Must know Node.js."])));
    const result = await createJobExtractor(test.db, env, generate).extract({ userId: user, text: POSTING });
    const prompt = generate.mock.calls[0]?.[0].prompt ?? "";
    expect(prompt).not.toContain("hiring@acme.example");
    expect(prompt).not.toContain("98765");
    expect(prompt).toContain("[email removed]");
    expect(result.maskedText).toBe(prompt);
    expect(result.extraction.validityRate).toBe(1);
    expect(result.extraction.job.requirements[0]).toMatchObject({
      skill: "nodejs",
      quote: "Must know Node.js.",
    });
  });

  it("retries once below 70 percent validity, keeps the better attempt, and caches per user", async () => {
    const user = await createAuthUser(test.db);
    const other = await createAuthUser(test.db);
    const generate = vi
      .fn()
      .mockResolvedValueOnce(reply(extraction(["Must know Node.js.", "Invented 1", "Invented 2"])))
      .mockResolvedValueOnce(reply(extraction(["Invented 3"])))
      .mockResolvedValue(reply(extraction(["Must know Node.js."])));
    const extractor = createJobExtractor(test.db, env, generate);
    const first = await extractor.extract({ userId: user, text: POSTING });
    expect(first.attempts).toBe(2);
    expect(first.extraction.valid).toBe(1);
    expect(first.extraction.total).toBe(3);
    expect(first.inputTokens).toBe(20);
    const again = await extractor.extract({ userId: user, text: POSTING });
    expect(again.cached).toBe(true);
    expect(again.extraction.job.requirements).toEqual(first.extraction.job.requirements);
    await extractor.extract({ userId: other, text: POSTING });
    expect(generate).toHaveBeenCalledTimes(3);
  });
});

describe("explanations", () => {
  const requirements = [
    {
      id: "r1",
      type: "core_skill" as const,
      text: "Node.js",
      quote: "Must know Node.js.",
      skill: "nodejs",
      eligibility: null,
    },
  ];
  const evidence = [
    {
      ref: "E1",
      kind: "project" as const,
      tier: "project" as const,
      heading: "Ledger",
      texts: ["Built a ledger API in Node.js"],
      skills: [],
    },
  ];
  const verify = (output: ExplanationOutput) =>
    verifyExplanation(output, { requirements, evidence, description: POSTING });
  const output = (resumeQuote: string): ExplanationOutput => ({
    summary: "Relevant project work.",
    strengths: [{ requirement: "R1", resumeQuote, note: "Built an API." }],
    gaps: [],
    checks: [],
  });

  it("accepts verified output and caches it", async () => {
    const user = await createAuthUser(test.db);
    const generate = vi.fn(async () => reply(output("built a ledger API in Node.js")));
    const explainer = createMatchExplainer(test.db, env, generate);
    const first = await explainer.explain({ userId: user, prompt: "prompt-a", verify });
    expect(first.verified?.strengths).toHaveLength(1);
    expect(first.validityRates).toEqual([1]);
    expect((await explainer.explain({ userId: user, prompt: "prompt-a", verify })).cached).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("regenerates once when more than 30 percent of quotes fail, then falls back", async () => {
    const user = await createAuthUser(test.db);
    const generate = vi
      .fn()
      .mockResolvedValueOnce(reply(output("Led the Node.js platform team")))
      .mockResolvedValueOnce(reply(output("Built a ledger API in Node.js")));
    const recovered = await createMatchExplainer(test.db, env, generate).explain({
      userId: user,
      prompt: "prompt-b",
      verify,
    });
    expect(recovered.validityRates).toEqual([0, 1]);
    expect(recovered.output).not.toBeNull();

    const failing = vi.fn(async () => reply(output("Invented quote")));
    const fallback = await createMatchExplainer(test.db, env, failing).explain({
      userId: user,
      prompt: "prompt-c",
      verify,
    });
    expect(failing).toHaveBeenCalledTimes(2);
    expect(fallback).toMatchObject({ output: null, verified: null, validityRates: [0, 0] });
  });
});

describe("embeddings", () => {
  it("checks dimensions and names the model", async () => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    const embedder = createEmbedder(test.db, env, async (values) => values.map(() => vector));
    expect(embedder.model).toBe(`gemini:gemini-embedding-001:${EMBEDDING_DIMENSIONS}`);
    expect(await embedder.embed(["a", "b"])).toHaveLength(2);
    const broken = createEmbedder(test.db, env, async () => [[1, 2, 3]]);
    await expect(broken.embed(["a"])).rejects.toThrow(/dimensions/);
  });
});
