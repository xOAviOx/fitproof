import { readFile } from "node:fs/promises";
import { BOARD_CONNECTORS } from "@repo/connectors";
import { describe, expect, it } from "vitest";
import { loadSeed, SEED_PATH, seedSchema } from "./seed";

const entry = (overrides: Record<string, unknown> = {}) => ({
  slug: "acme",
  name: "Acme",
  ats: "greenhouse",
  boardToken: "acme",
  careersUrl: "https://acme.example/careers",
  locations: ["Bengaluru"],
  ...overrides,
});

describe("companies.seed.json", () => {
  it("is valid, and every active board has a connector", async () => {
    const companies = await loadSeed();
    expect(companies.length).toBeGreaterThan(50);
    for (const company of companies) expect(BOARD_CONNECTORS[company.ats], company.slug).toBeDefined();
  });

  it("explains every inactive entry", async () => {
    const raw = seedSchema.parse(JSON.parse(await readFile(SEED_PATH, "utf8")));
    for (const company of raw.companies.filter((item) => !item.active)) {
      expect(company.note, company.slug).toMatch(/\w/);
    }
  });
});

describe("seedSchema", () => {
  it("rejects duplicate slugs and boards, unknown places, and plain-http careers links", () => {
    const parse = (companies: unknown[]) => seedSchema.safeParse({ version: 1, companies }).success;
    expect(parse([entry()])).toBe(true);
    expect(parse([entry(), entry({ boardToken: "other" })])).toBe(false);
    expect(parse([entry(), entry({ slug: "acme-2", boardToken: "ACME" })])).toBe(false);
    expect(parse([entry({ locations: ["Chennai"] })])).toBe(false);
    expect(parse([entry({ careersUrl: "http://acme.example/careers" })])).toBe(false);
  });
});
