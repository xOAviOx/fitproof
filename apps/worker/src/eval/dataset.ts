import { readFile } from "node:fs/promises";
import {
  ELIGIBILITY_KINDS,
  jobTextSchema,
  MATCH_BANDS,
  preferencesSchema,
  profileContentSchema,
  ROLE_FAMILIES,
} from "@repo/core";
import { z } from "zod";

export const EVAL_DIR = new URL("../../../../data/eval/", import.meta.url);

const profilesSchema = z.object({
  profiles: z
    .array(
      z.object({
        id: z.string().min(1),
        family: z.enum(ROLE_FAMILIES),
        description: z.string().min(1),
        content: profileContentSchema,
        preferences: preferencesSchema,
      }),
    )
    .min(1),
});

const jobsSchema = z.object({
  asOf: z.iso.date(),
  jobs: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        family: z.enum(ROLE_FAMILIES),
        labels: z.object({
          coreSkills: z.array(z.string().min(1)).min(1),
          niceToHave: z.array(z.string().min(1)),
          eligibility: z.array(z.enum(ELIGIBILITY_KINDS)),
        }),
        pairs: z.array(z.object({ profile: z.string().min(1), band: z.enum(MATCH_BANDS) })).min(1),
      }),
    )
    .min(1),
});

export type EvalProfile = z.infer<typeof profilesSchema>["profiles"][number];
export type EvalJob = z.infer<typeof jobsSchema>["jobs"][number] & { text: string };
export type EvalDataset = { asOf: string; profiles: EvalProfile[]; jobs: EvalJob[] };

const readJson = async (name: string) => JSON.parse(await readFile(new URL(name, EVAL_DIR), "utf8"));

/** Loads and validates `data/eval`. Throws on malformed files or pairs that name unknown profiles. */
export async function loadDataset(): Promise<EvalDataset> {
  const { profiles } = profilesSchema.parse(await readJson("profiles.json"));
  const { asOf, jobs } = jobsSchema.parse(await readJson("jobs.json"));
  for (const profile of profiles) {
    // saveProfile marks standalone skills self-declared, so any other tier here would be silently ignored.
    if (profile.content.skills.some((skill) => skill.tier !== "self_declared")) {
      throw new Error(`${profile.id}: list evidence-backed skills on the entry that shows them`);
    }
  }
  const known = new Set(profiles.map((profile) => profile.id));
  const withText = await Promise.all(
    jobs.map(async (job) => {
      for (const pair of job.pairs) {
        if (!known.has(pair.profile)) throw new Error(`${job.id}: unknown profile "${pair.profile}"`);
      }
      const text = jobTextSchema.parse(await readFile(new URL(`jobs/${job.id}.txt`, EVAL_DIR), "utf8"));
      return { ...job, text };
    }),
  );
  return { asOf, profiles, jobs: withText };
}
