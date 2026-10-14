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

const placeSchema = z
  .object({
    postalAddress: z
      .object({
        addressLocality: z.string().nullish(),
        addressRegion: z.string().nullish(),
        addressCountry: z.string().nullish(),
      })
      .nullish(),
  })
  .nullish();

const jobSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  secondaryLocations: z.array(z.object({ location: z.string().nullish(), address: placeSchema })).nullish(),
  address: placeSchema,
  isListed: z.boolean().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  employmentType: z.string().nullish(),
  publishedAt: z.string().nullish(),
  jobUrl: z.string().nullish(),
  applyUrl: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  descriptionPlain: z.string().nullish(),
});

const addressText = (place: z.output<typeof placeSchema>) => {
  const address = place?.postalAddress;
  return compact([address?.addressLocality, address?.addressRegion, address?.addressCountry]).join(", ");
};

/** One request returns the whole board with descriptions. */
export const ashby: BoardConnector = {
  ats: "ashby",
  async list(board, client) {
    const body = parsePayload(
      z.object({ jobs: z.array(z.unknown()) }),
      await client.getJson(`https://api.ashbyhq.com/posting-api/job-board/${boardPath(board.boardToken)}`),
      "Ashby board",
    );
    return parseItems(jobSchema, body.jobs)
      .filter(({ item }) => item.isListed !== false)
      .map(({ item, raw }) => {
        const places = compact([
          item.location,
          addressText(item.address),
          ...(item.secondaryLocations ?? []).flatMap((place) => [place.location, addressText(place.address)]),
        ]);
        return {
          source: "ashby" as const,
          sourceJobId: `${board.boardToken}/${item.id}`,
          title: item.title.trim(),
          companyName: board.companyName,
          // `isRemote` is also true for some hybrid roles, so it only counts when no work mode is given.
          location: { texts: places, workplace: [item.workplaceType ?? item.isRemote ?? null] },
          locationText: places.join("; "),
          employmentHints: compact([item.employmentType]),
          experienceLabel: null,
          sourceUrl: item.jobUrl ?? null,
          applyUrl: item.applyUrl ?? item.jobUrl ?? null,
          postedAt: item.publishedAt ?? null,
          salary: null,
          descriptionText: joinSections([
            item.descriptionHtml ? htmlFieldToText(item.descriptionHtml) : item.descriptionPlain,
          ]),
          detailVersion: null,
          raw: omit(raw, ["descriptionHtml", "descriptionPlain"]),
        };
      });
  },
};
