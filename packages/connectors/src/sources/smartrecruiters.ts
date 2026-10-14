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

const API = "https://api.smartrecruiters.com/v1/companies";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

const labelled = z.object({ id: z.string().nullish(), label: z.string().nullish() }).nullish();
const postingSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().nullish(),
  company: z.object({ name: z.string().nullish() }).nullish(),
  location: z
    .object({
      city: z.string().nullish(),
      region: z.string().nullish(),
      country: z.string().nullish(),
      fullLocation: z.string().nullish(),
      remote: z.boolean().nullish(),
      hybrid: z.boolean().nullish(),
    })
    .nullish(),
  typeOfEmployment: labelled,
  experienceLevel: labelled,
});
const pageSchema = z.object({ totalFound: z.number(), content: z.array(z.unknown()) });
const section = z.object({ title: z.string().nullish(), text: z.string().nullish() }).nullish();
const detailSchema = z.object({
  postingUrl: z.string().nullish(),
  applyUrl: z.string().nullish(),
  jobAd: z
    .object({
      sections: z
        .object({
          companyDescription: section,
          jobDescription: section,
          qualifications: section,
          additionalInformation: section,
        })
        .nullish(),
    })
    .nullish(),
});

/**
 * Listed with `country=in` so a large employer's worldwide board isn't paged through. The listing
 * omits descriptions, so in-scope postings are fetched one by one when `releasedDate` changes.
 */
export const smartrecruiters: BoardConnector = {
  ats: "smartrecruiters",
  async list(board, client) {
    const company = boardPath(board.boardToken);
    const items: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = parsePayload(
        pageSchema,
        await client.getJson(
          `${API}/${company}/postings?country=in&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
        ),
        "SmartRecruiters board",
      );
      items.push(...body.content);
      if (body.content.length < PAGE_SIZE || items.length >= body.totalFound) break;
    }
    return parseItems(postingSchema, items).map(({ item, raw }) => {
      const place = item.location;
      const places = compact([place?.fullLocation?.replace(/(,\s*)+/g, ", ") ?? place?.city]);
      return {
        source: "smartrecruiters" as const,
        sourceJobId: `${board.boardToken}/${item.id}`,
        title: item.name.trim(),
        companyName: item.company?.name?.trim() || board.companyName,
        location: {
          texts: places,
          countryCodes: [place?.country],
          workplace: [place?.remote ? "remote" : place?.hybrid ? "hybrid" : null],
        },
        locationText: places.join("; "),
        employmentHints: compact([item.typeOfEmployment?.label, item.typeOfEmployment?.id]),
        experienceLabel: item.experienceLevel?.label ?? null,
        sourceUrl: `https://jobs.smartrecruiters.com/${company}/${encodeURIComponent(item.id)}`,
        applyUrl: null,
        postedAt: item.releasedDate ?? null,
        salary: null,
        descriptionText: null,
        detailVersion: item.releasedDate ?? item.id,
        raw,
      };
    });
  },
  async detail(board, posting, client) {
    const id = posting.sourceJobId.slice(posting.sourceJobId.lastIndexOf("/") + 1);
    const raw = await client.getJson(
      `${API}/${boardPath(board.boardToken)}/postings/${encodeURIComponent(id)}`,
    );
    const detail = parsePayload(detailSchema, raw, "SmartRecruiters posting");
    const sections = detail.jobAd?.sections;
    return {
      descriptionText: joinSections(
        [
          sections?.jobDescription,
          sections?.qualifications,
          sections?.additionalInformation,
          sections?.companyDescription,
        ].map((part) => (part?.text ? joinSections([part.title, htmlFieldToText(part.text)]) : null)),
      ),
      sourceUrl: detail.postingUrl ?? posting.sourceUrl,
      applyUrl: detail.applyUrl ?? detail.postingUrl ?? null,
      raw: omit(raw as Record<string, unknown>, ["jobAd", "creator"]),
    };
  },
};
