import type { JobSalary } from "@repo/core";
import { z } from "zod";
import { htmlFieldToText } from "../extract";
import {
  type BoardConnector,
  boardPath,
  compact,
  joinSections,
  omit,
  parseItems,
  parsePayload,
} from "./types";

const postingSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.number().nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  hostedUrl: z.string().nullish(),
  applyUrl: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
      commitment: z.string().nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additional: z.string().nullish(),
  salaryRange: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      interval: z.string().nullish(),
    })
    .nullish(),
});

const DESCRIPTION_FIELDS = [
  "description",
  "descriptionPlain",
  "descriptionBody",
  "descriptionBodyPlain",
  "opening",
  "openingPlain",
  "lists",
  "additional",
  "additionalPlain",
];

function salaryFrom(range: z.output<typeof postingSchema>["salaryRange"]): JobSalary | null {
  if (!range || (range.min == null && range.max == null)) return null;
  const interval = range.interval ?? "";
  const period = /year|annual/.test(interval) ? "year" : /month/.test(interval) ? "month" : null;
  if (!period) return null;
  return { min: range.min ?? null, max: range.max ?? null, currency: range.currency ?? null, period };
}

/** One request returns the whole board with descriptions. */
export const lever: BoardConnector = {
  ats: "lever",
  async list(board, client) {
    const host = board.region === "eu" ? "https://api.eu.lever.co" : "https://api.lever.co";
    const body = parsePayload(
      z.array(z.unknown()),
      await client.getJson(`${host}/v0/postings/${boardPath(board.boardToken)}?mode=json`),
      "Lever board",
    );
    return parseItems(postingSchema, body).map(({ item, raw }) => {
      const places = compact([item.categories?.location, ...(item.categories?.allLocations ?? [])]);
      const lists = (item.lists ?? []).map((list) =>
        joinSections([list.text, htmlFieldToText(`<ul>${list.content ?? ""}</ul>`)]),
      );
      const description = item.description
        ? htmlFieldToText(item.description)
        : (item.descriptionPlain ?? "");
      return {
        source: "lever" as const,
        sourceJobId: `${board.boardToken}/${item.id}`,
        title: item.text.trim(),
        companyName: board.companyName,
        location: {
          texts: places,
          countryCodes: [item.country],
          workplace: [item.workplaceType === "unspecified" ? null : item.workplaceType],
        },
        locationText: places.join("; "),
        employmentHints: compact([item.categories?.commitment]),
        experienceLabel: null,
        sourceUrl: item.hostedUrl ?? null,
        applyUrl: item.applyUrl ?? item.hostedUrl ?? null,
        postedAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
        salary: salaryFrom(item.salaryRange),
        descriptionText: joinSections([description, ...lists, htmlFieldToText(item.additional ?? "")]),
        detailVersion: null,
        raw: omit(raw, DESCRIPTION_FIELDS),
      };
    });
  },
};
