import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ATS_TYPES, PRODUCT } from "@repo/core";
import type { RegistryCompany } from "@repo/db";
import { z } from "zod";

export const SEED_PATH = fileURLToPath(new URL("../../../../data/companies.seed.json", import.meta.url));

const PLACES = [...PRODUCT.cities, "Remote"] as const;

const companySchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/, "lowercase letters, digits, and hyphens"),
  name: z.string().trim().min(1).max(120),
  ats: z.enum(ATS_TYPES),
  boardToken: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
  region: z.enum(["eu"]).nullish(),
  careersUrl: z.url({ protocol: /^https$/ }).nullish(),
  hq: z.string().max(120).nullish(),
  locations: z.array(z.enum(PLACES)).default([]),
  /** Kept in the file but not crawled, e.g. while a board's robots.txt disallows us. */
  active: z.boolean().default(true),
  note: z.string().max(500).optional(),
});

export const seedSchema = z
  .object({ version: z.number().int(), companies: z.array(companySchema).min(1) })
  .superRefine((seed, context) => {
    const slugs = new Set<string>();
    const boards = new Set<string>();
    seed.companies.forEach((company, index) => {
      const board = `${company.ats}:${company.boardToken.toLowerCase()}`;
      if (slugs.has(company.slug)) {
        context.addIssue({ code: "custom", path: ["companies", index, "slug"], message: "duplicate slug" });
      }
      if (boards.has(board)) {
        context.addIssue({
          code: "custom",
          path: ["companies", index, "boardToken"],
          message: "duplicate board",
        });
      }
      slugs.add(company.slug);
      boards.add(board);
    });
  });

/** The registry's source of truth. Inactive entries are left out, so syncing deactivates them. */
export async function loadSeed(path = SEED_PATH): Promise<RegistryCompany[]> {
  const parsed = seedSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid ${path}:\n${issues.join("\n")}`);
  }
  return parsed.data.companies
    .filter((company) => company.active)
    .map((company) => ({
      slug: company.slug,
      name: company.name,
      ats: company.ats,
      boardToken: company.boardToken,
      region: company.region ?? null,
      careersUrl: company.careersUrl ?? null,
      hq: company.hq ?? null,
      locations: company.locations,
    }));
}
