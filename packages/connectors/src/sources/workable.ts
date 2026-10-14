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

const jobSchema = z.object({
  title: z.string(),
  shortcode: z.string(),
  employment_type: z.string().nullish(),
  telecommuting: z.boolean().nullish(),
  url: z.string().nullish(),
  application_url: z.string().nullish(),
  published_on: z.string().nullish(),
  country: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  experience: z.string().nullish(),
  locations: z
    .array(
      z.object({
        city: z.string().nullish(),
        region: z.string().nullish(),
        country: z.string().nullish(),
        countryCode: z.string().nullish(),
        hidden: z.boolean().nullish(),
      }),
    )
    .nullish(),
  description: z.string().nullish(),
});

type ParsedJob = { item: z.infer<typeof jobSchema>; raw: Record<string, unknown> };

/** One request returns the whole board with descriptions. */
export const workable: BoardConnector = {
  ats: "workable",
  async list(board, client) {
    const body = parsePayload(
      z.object({ name: z.string().nullish(), jobs: z.array(z.unknown()) }),
      await client.getJson(
        `https://apply.workable.com/api/v1/widget/accounts/${boardPath(board.boardToken)}?details=true`,
      ),
      "Workable board",
    );
    // The widget repeats a job once per location, with the same shortcode and description.
    const byShortcode = new Map<string, ParsedJob[]>();
    for (const parsed of parseItems(jobSchema, body.jobs)) {
      const copies = byShortcode.get(parsed.item.shortcode);
      if (copies) copies.push(parsed);
      else byShortcode.set(parsed.item.shortcode, [parsed]);
    }
    return [...byShortcode.values()].map((copies) => {
      const [{ item, raw }] = copies as [ParsedJob, ...ParsedJob[]];
      const visible = copies.flatMap((copy) => (copy.item.locations ?? []).filter((place) => !place.hidden));
      const places = [
        ...new Set(
          compact([
            ...visible.map((place) => compact([place.city, place.region, place.country]).join(", ")),
            ...(visible.length
              ? []
              : copies.map((copy) =>
                  compact([copy.item.city, copy.item.state, copy.item.country]).join(", "),
                )),
          ]),
        ),
      ];
      return {
        source: "workable" as const,
        sourceJobId: `${board.boardToken}/${item.shortcode}`,
        title: item.title.trim(),
        companyName: body.name?.trim() || board.companyName,
        location: {
          texts: places,
          countryCodes: visible.map((place) => place.countryCode),
          workplace: [item.telecommuting ?? null],
        },
        locationText: places.join("; "),
        employmentHints: compact([item.employment_type]),
        experienceLabel: item.experience || null,
        sourceUrl: item.url ?? null,
        applyUrl: item.application_url ?? item.url ?? null,
        postedAt: item.published_on ?? null,
        salary: null,
        descriptionText: joinSections([htmlFieldToText(item.description ?? "")]),
        detailVersion: null,
        raw: omit(raw, ["description"]),
      };
    });
  },
};
