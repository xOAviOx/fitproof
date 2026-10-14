import { z } from "zod";
import { htmlFieldToText } from "../extract";
import { type BoardConnector, boardPath, joinSections, omit, parseItems, parsePayload } from "./types";

const API = "https://boards-api.greenhouse.io/v1/boards";

const jobSchema = z.object({
  id: z.number(),
  title: z.string(),
  updated_at: z.string().nullish(),
  first_published: z.string().nullish(),
  absolute_url: z.string().nullish(),
  company_name: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
});
const detailSchema = z.object({ absolute_url: z.string().nullish(), content: z.string().nullish() });

/**
 * The listing omits descriptions (with them, large boards run to ~10 MB), so only in-scope jobs
 * are fetched one by one, and only when `updated_at` changes.
 */
export const greenhouse: BoardConnector = {
  ats: "greenhouse",
  async list(board, client) {
    const body = parsePayload(
      z.object({ jobs: z.array(z.unknown()) }),
      await client.getJson(`${API}/${boardPath(board.boardToken)}/jobs`),
      "Greenhouse board",
    );
    return parseItems(jobSchema, body.jobs).map(({ item, raw }) => {
      const place = item.location?.name?.trim() ?? "";
      return {
        source: "greenhouse" as const,
        sourceJobId: `${board.boardToken}/${item.id}`,
        title: item.title.trim(),
        companyName: item.company_name?.trim() || board.companyName,
        location: { texts: [place] },
        locationText: place,
        employmentHints: [],
        experienceLabel: null,
        sourceUrl: item.absolute_url ?? null,
        applyUrl: item.absolute_url ?? null,
        postedAt: item.first_published ?? null,
        salary: null,
        descriptionText: null,
        detailVersion: item.updated_at ?? String(item.id),
        raw,
      };
    });
  },
  async detail(board, posting, client) {
    const id = posting.sourceJobId.slice(posting.sourceJobId.lastIndexOf("/") + 1);
    const raw = await client.getJson(`${API}/${boardPath(board.boardToken)}/jobs/${encodeURIComponent(id)}`);
    const job = parsePayload(detailSchema, raw, "Greenhouse job");
    return {
      descriptionText: joinSections([htmlFieldToText(job.content ?? "")]),
      sourceUrl: job.absolute_url ?? posting.sourceUrl,
      applyUrl: job.absolute_url ?? posting.applyUrl,
      raw: omit(raw as Record<string, unknown>, ["content"]),
    };
  },
};
