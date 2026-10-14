import { readFileSync } from "node:fs";
import { assessPosting, readLocation } from "@repo/core";
import { describe, expect, it } from "vitest";
import { searchAdzuna } from "./adzuna";
import { ashby } from "./ashby";
import { type SourceClient, SourceError } from "./client";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import type { BoardRef, ListedPosting } from "./types";
import { workable } from "./workable";

/** Trimmed real responses (October 2026), except Adzuna's, which follows the documented shape. */
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));

function fakeClient(routes: Record<string, string>): SourceClient & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    requests: 0,
    async getJson(url) {
      urls.push(url);
      const match = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
      if (!match) throw new SourceError("not_found", `no route for ${url}`, 404);
      return fixture(match[1]);
    },
  };
}

const board = (ats: BoardRef["ats"], boardToken: string, companyName: string): BoardRef => ({
  ats,
  boardToken,
  companyName,
});

const scope = (posting: ListedPosting) =>
  assessPosting({
    title: posting.title,
    location: posting.location,
    employmentHints: posting.employmentHints,
    experienceLabel: posting.experienceLabel,
  });

describe("greenhouse", () => {
  const ref = board("greenhouse", "databricks", "Databricks");
  const client = fakeClient({
    "https://boards-api.greenhouse.io/v1/boards/databricks/jobs/": "greenhouse-job",
    "https://boards-api.greenhouse.io/v1/boards/databricks/jobs": "greenhouse-list",
  });

  it("lists the board without descriptions, then reads one job's escaped HTML", async () => {
    const postings = await greenhouse.list(ref, client);
    expect(postings).toHaveLength(4);
    const sde = postings.find((posting) => posting.title === "Software Engineer (Backend - SDE 2)");
    expect(sde).toMatchObject({
      sourceJobId: "databricks/7955594002",
      companyName: "Databricks",
      locationText: "Bengaluru, India",
      descriptionText: null,
      detailVersion: "2026-10-07T22:48:48-04:00",
      applyUrl: "https://databricks.com/company/careers/open-positions/job?gh_jid=7955594002",
    });
    if (!sde) throw new Error("missing");
    expect(scope(sde)).toMatchObject({ keep: true, roleFamily: "backend", seniority: "mid" });
    expect(postings.map((posting) => scope(posting).keep)).toEqual(
      postings.map((posting) => ["7955594002", "8829029002"].some((id) => posting.sourceJobId.endsWith(id))),
    );

    const detail = await greenhouse.detail?.(ref, sde, client);
    expect(client.urls.at(-1)).toBe("https://boards-api.greenhouse.io/v1/boards/databricks/jobs/7955594002");
    expect(detail?.descriptionText).toMatch(/^P-928\n\nAt Databricks, we are passionate/);
    expect(detail?.descriptionText).not.toMatch(/&lt;|<p>|&#39;/);
    expect(detail?.raw).not.toHaveProperty("content");
  });

  it("rejects a token that would change the URL path", async () => {
    await expect(greenhouse.list(board("greenhouse", "../admin", "X"), client)).rejects.toThrow(
      /Invalid board token/,
    );
  });
});

describe("lever", () => {
  it("reads location, work mode, commitment, and joins the description sections", async () => {
    const client = fakeClient({ "https://api.lever.co/v0/postings/zeta?mode=json": "lever" });
    const postings = await lever.list(board("lever", "zeta", "Zeta"), client);
    expect(postings).toHaveLength(3);
    const [network, sre] = postings;
    expect(network).toMatchObject({
      source: "lever",
      sourceJobId: "zeta/dad16204-8051-4517-9e50-966f329045b5",
      title: "Cloud Network Engineer II",
      companyName: "Zeta",
      locationText: "Hyderabad",
      location: { countryCodes: ["IN"], workplace: ["onsite"] },
      employmentHints: ["Full-time"],
      sourceUrl: "https://jobs.lever.co/zeta/dad16204-8051-4517-9e50-966f329045b5",
      detailVersion: null,
    });
    expect(network?.descriptionText?.length).toBeGreaterThan(200);
    expect(network?.raw).not.toHaveProperty("descriptionPlain");
    expect(network?.raw).not.toHaveProperty("lists");
    if (!network || !sre) throw new Error("missing");
    expect(scope(network)).toEqual({ keep: false, reason: "role" });
    expect(scope(sre)).toEqual({ keep: false, reason: "role" });
  });

  it("uses the EU host for EU accounts", async () => {
    const client = fakeClient({ "https://api.eu.lever.co/v0/postings/acme?mode=json": "lever" });
    await lever.list({ ...board("lever", "acme", "Acme"), region: "eu" }, client);
    expect(client.urls).toEqual(["https://api.eu.lever.co/v0/postings/acme?mode=json"]);
  });
});

describe("ashby", () => {
  it("prefers the work-mode field over isRemote and converts the HTML description", async () => {
    const client = fakeClient({ "https://api.ashbyhq.com/posting-api/job-board/notion": "ashby" });
    const postings = await ashby.list(board("ashby", "notion", "Notion"), client);
    expect(postings).toHaveLength(3);
    const [devex] = postings;
    expect(devex).toMatchObject({
      title: "Software Engineer, Developer Experience",
      locationText: "Hyderabad, India",
      location: { workplace: ["Hybrid"] },
      employmentHints: ["FullTime"],
      applyUrl: "https://jobs.ashbyhq.com/notion/49bdf081-6e20-4323-8c73-6d6b19544ff5/application",
    });
    expect(devex?.descriptionText).toMatch(/^Who We Are\n/);
    if (!devex) throw new Error("missing");
    expect(scope(devex)).toMatchObject({
      keep: true,
      roleFamily: "backend",
      remoteType: "hybrid",
      employmentType: "full_time",
      locations: ["Hyderabad"],
    });
  });
});

describe("smartrecruiters", () => {
  const ref = board("smartrecruiters", "BoschGroup", "Bosch");
  const client = fakeClient({
    "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?": "smartrecruiters-list",
    "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/": "smartrecruiters-posting",
  });

  it("lists Indian postings, then reads the sections of one", async () => {
    const postings = await smartrecruiters.list(ref, client);
    expect(client.urls[0]).toBe(
      "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?country=in&limit=100&offset=0",
    );
    expect(postings).toHaveLength(3);
    const fullStack = postings.find((posting) => posting.sourceJobId === "BoschGroup/744000155451389");
    expect(fullStack).toMatchObject({
      companyName: "Bosch Group",
      locationText: "hosur road bangalore, India",
      experienceLabel: "Associate",
      employmentHints: ["Full-time", "permanent"],
      descriptionText: null,
    });
    if (!fullStack) throw new Error("missing");
    expect(scope(fullStack)).toMatchObject({ keep: true, roleFamily: "backend", locations: ["Bengaluru"] });
    const senior = postings.find((posting) => posting.title.startsWith("Sr MATLAB"));
    if (!senior) throw new Error("missing");
    expect(scope(senior)).toEqual({ keep: false, reason: "seniority" });

    const detail = await smartrecruiters.detail?.(ref, fullStack, client);
    expect(detail?.descriptionText).toMatch(/^Job Description\n/);
    expect(detail?.descriptionText).toContain("Qualifications\n\nB.E");
    expect(detail?.applyUrl).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/BoschGroup\/744000155451389/);
    expect(detail?.raw).not.toHaveProperty("jobAd");
  });
});

describe("workable", () => {
  it("reads visible locations and the remote flag", async () => {
    const client = fakeClient({
      "https://apply.workable.com/api/v1/widget/accounts/huggingface": "workable",
    });
    const postings = await workable.list(board("workable", "huggingface", "HF"), client);
    expect(postings).toHaveLength(2);
    expect(postings[0]).toMatchObject({
      sourceJobId: "huggingface/81B46579FE",
      companyName: "Hugging Face",
      locationText: "Paris, Île-de-France, France",
      location: { countryCodes: ["FR"], workplace: [true] },
      applyUrl: "https://apply.workable.com/j/81B46579FE/apply",
    });
    expect(postings[0]?.descriptionText).toContain("At Hugging Face");
    if (!postings[0]) throw new Error("missing");
    expect(scope(postings[0])).toEqual({ keep: false, reason: "location" });
  });

  it("merges a job the widget repeats once per location", async () => {
    const client = fakeClient({
      "https://apply.workable.com/api/v1/widget/accounts/capgemini-insurance": "workable-repeated",
    });
    const postings = await workable.list(board("workable", "capgemini-insurance", "Capgemini"), client);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      sourceJobId: "capgemini-insurance/F83336ECF0",
      locationText: "Pune, Maharashtra, India; Hyderabad, Telangana, India",
      location: { countryCodes: ["IN", "IN"] },
    });
    if (!postings[0]) throw new Error("missing");
    expect(readLocation(postings[0].location).targetCities).toEqual(["Hyderabad", "Pune"]);
    // "Team Member III" is a senior level.
    expect(scope(postings[0])).toEqual({ keep: false, reason: "seniority" });
  });
});

describe("adzuna", () => {
  it("strips highlighting, ignores predicted salaries, and skips ads without a company", async () => {
    const client = fakeClient({ "https://api.adzuna.com/v1/api/jobs/in/search/1?": "adzuna" });
    const { postings, total } = await searchAdzuna(
      { appId: "id", appKey: "secret" },
      {
        country: "in",
        what: "software engineer",
        where: "Bengaluru",
        page: 1,
        resultsPerPage: 50,
        maxDaysOld: 7,
      },
      client,
    );
    expect(total).toBe(3);
    expect(new URL(client.urls[0] ?? "").searchParams.get("what")).toBe("software engineer");
    expect(postings.map((posting) => posting.sourceJobId)).toEqual(["5011223344", "5011223355"]);
    const [engineer, analyst] = postings;
    expect(engineer).toMatchObject({
      source: "adzuna",
      title: "Software Engineer (Backend - SDE 2)",
      companyName: "Databricks India Private Limited",
      salary: null,
      locationText: "Bangalore, Karnataka",
    });
    expect(engineer?.descriptionText).not.toContain("<strong>");
    expect(analyst?.salary).toEqual({ min: 600000, max: 900000, currency: "INR", period: "year" });
    if (!engineer || !analyst) throw new Error("missing");
    expect(scope(engineer)).toMatchObject({ keep: true, locations: ["Bengaluru"] });
    expect(scope(analyst)).toMatchObject({
      keep: true,
      roleFamily: "data_analyst",
      locations: ["Hyderabad"],
    });
  });
});
