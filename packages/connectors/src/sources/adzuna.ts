import { z } from "zod";
import { htmlToText } from "../extract";
import type { SourceClient } from "./client";
import { compact, type ListedPosting, omit, parseItems, parsePayload } from "./types";

export const ADZUNA_HOST = "api.adzuna.com";

export type AdzunaKeys = { appId: string; appKey: string };
export type AdzunaQuery = {
  country: string;
  what: string;
  where: string;
  page: number;
  resultsPerPage: number;
  maxDaysOld: number;
};

const adSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string(),
  description: z.string().nullish(),
  created: z.string().nullish(),
  redirect_url: z.string().nullish(),
  company: z.object({ display_name: z.string().nullish() }).nullish(),
  location: z.object({ display_name: z.string().nullish(), area: z.array(z.string()).nullish() }).nullish(),
  contract_time: z.string().nullish(),
  contract_type: z.string().nullish(),
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  salary_is_predicted: z.union([z.string(), z.number()]).nullish(),
});

/**
 * One page of Adzuna search results. Ads carry only a snippet of the description and link to
 * Adzuna's own page, which must be credited wherever the ad is shown.
 */
export async function searchAdzuna(
  keys: AdzunaKeys,
  query: AdzunaQuery,
  client: SourceClient,
): Promise<{ postings: ListedPosting[]; total: number }> {
  const params = new URLSearchParams({
    app_id: keys.appId,
    app_key: keys.appKey,
    results_per_page: String(query.resultsPerPage),
    what: query.what,
    where: query.where,
    max_days_old: String(query.maxDaysOld),
    sort_by: "date",
    "content-type": "application/json",
  });
  const url = `https://${ADZUNA_HOST}/v1/api/jobs/${encodeURIComponent(query.country)}/search/${query.page}?${params}`;
  const body = parsePayload(
    z.object({ count: z.number().nullish(), results: z.array(z.unknown()) }),
    await client.getJson(url),
    "Adzuna search",
  );
  const postings = parseItems(adSchema, body.results).flatMap(({ item, raw }) => {
    const companyName = htmlToText(item.company?.display_name ?? "");
    if (!companyName) return [];
    const places = compact([item.location?.display_name, ...(item.location?.area ?? [])]);
    const predicted = String(item.salary_is_predicted ?? "0") === "1";
    return [
      {
        source: "adzuna" as const,
        sourceJobId: item.id,
        title: htmlToText(item.title),
        companyName,
        location: { texts: places, countryCodes: [query.country] },
        locationText: compact([item.location?.display_name]).join("; "),
        employmentHints: compact([item.contract_type, item.contract_time]),
        experienceLabel: null,
        sourceUrl: item.redirect_url ?? null,
        applyUrl: item.redirect_url ?? null,
        postedAt: item.created ?? null,
        salary:
          !predicted && (item.salary_min != null || item.salary_max != null)
            ? {
                min: item.salary_min ?? null,
                max: item.salary_max ?? null,
                currency: query.country === "in" ? "INR" : null,
                period: "year",
              }
            : null,
        descriptionText: htmlToText(item.description ?? ""),
        detailVersion: null,
        raw: omit(raw, ["description"]),
      },
    ];
  });
  return { postings, total: body.count ?? postings.length };
}
