import { emptyProfile } from "@repo/core";
import { createAuthUser, createTestDb, type TestDb } from "@repo/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProfileExtractor, llmEnvSchema } from "./index";

let test: TestDb;
beforeAll(async () => {
  test = await createTestDb();
}, 30_000);
afterAll(async () => {
  await test.close();
});
const env = llmEnvSchema.parse({ GEMINI_API_KEY: "synthetic-test-key", LLM_RPM: 100 });
const response = () => ({
  ...emptyProfile(),
  skills: [{ name: "SQL", tier: "self_declared" as const, sourceText: "Skills: SQL", userConfirmed: false }],
});
describe("provider boundary", () => {
  it("requires only the selected provider key and an explicit alternative model", () => {
    expect(llmEnvSchema.safeParse({}).success).toBe(false);
    expect(llmEnvSchema.safeParse({ GEMINI_API_KEY: "test", OPENAI_API_KEY: "" }).success).toBe(true);
    expect(llmEnvSchema.safeParse({ GEMINI_API_KEY: "", OPENAI_API_KEY: "" }).success).toBe(false);
    expect(llmEnvSchema.safeParse({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "test" }).success).toBe(false);
    expect(
      llmEnvSchema.safeParse({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-4.1-mini", OPENAI_API_KEY: "test" })
        .success,
    ).toBe(true);
  });
  it("caches by user, provider, model, prompt version, and input", async () => {
    const user = await createAuthUser(test.db);
    const other = await createAuthUser(test.db);
    const generate = vi.fn(async () => ({ object: response(), inputTokens: 10, outputTokens: 20 }));
    const extractor = createProfileExtractor(test.db, env, generate);
    expect((await extractor.extract(user, "Skills: SQL")).cached).toBe(false);
    expect((await extractor.extract(user, "Skills: SQL")).cached).toBe(true);
    await extractor.extract(other, "Skills: SQL");
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("regenerates once when more than 30 percent of quotes fail, then drops invalid entries", async () => {
    const user = await createAuthUser(test.db);
    const generate = vi.fn(async () => ({
      object: {
        ...response(),
        skills: [
          { name: "Rust", tier: "paid_work", sourceText: "Invented Rust experience", userConfirmed: true },
        ],
      },
      inputTokens: 10,
      outputTokens: 20,
    }));
    const result = await createProfileExtractor(test.db, env, generate).extract(user, "Skills: SQL");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.content.skills).toEqual([]);
    expect(result.quoteValidityRate).toBe(0);
    expect(result.inputTokens).toBe(20);
  });
  it("enforces daily budgets before contacting the provider", async () => {
    const user = await createAuthUser(test.db);
    const generate = vi.fn(async () => ({ object: response(), inputTokens: 10, outputTokens: 20 }));
    const limited = { ...env, LLM_MODEL: "test-budget-model", LLM_DAILY_REQUESTS: 1 };
    const extractor = createProfileExtractor(test.db, limited, generate);
    await extractor.extract(user, "Skills: SQL");
    await expect(extractor.extract(user, "Skills: SQL\nProjects")).rejects.toThrow(/Too many/);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
