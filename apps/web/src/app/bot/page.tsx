import { BOT, COLLECTION_CONFIG, PRODUCT } from "@repo/core";
import type { Metadata } from "next";

export const metadata: Metadata = { title: `About ${BOT.token}` };

const TOKEN = BOT.token;

const FACTS = [
  {
    title: "What it reads",
    body: `Two things. When a signed-in ${PRODUCT.name} user submits a job link, it fetches that one page, and later re-checks it at most once a day to see whether the job has closed. Every ${COLLECTION_CONFIG.everyHours} hours, it reads the public job-board APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable) of the companies in our registry, the same feeds that power their careers pages. It does not crawl, follow links, or index sites.`,
  },
  {
    title: "Honors robots.txt",
    body: `Before fetching, it reads /robots.txt (cached for an hour) and obeys the rules and any Crawl-delay for “${TOKEN}”, or “*” if there are none. Redirect targets are checked the same way. If robots.txt fails with a server error or can’t be reached, it fetches nothing.`,
  },
  {
    title: "Light on your servers",
    body: `One request per company board per run, plus one per new or changed posting when a board lists jobs without their descriptions. Requests to a host are at least ${COLLECTION_CONFIG.requestGapMs} ms apart and back off on errors. A link a user submitted is read once and reused for a day.`,
  },
  {
    title: "No sign-in walls",
    body: "It sends no cookies or credentials, so it only sees what an anonymous visitor sees. Sites whose terms forbid automated access, such as LinkedIn and Naukri, are never fetched; users paste those descriptions instead.",
  },
];

export default function BotPage() {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:py-14">
      <p className="mb-3 font-mono text-xs tracking-[0.16em] text-muted-foreground">FOR SITE OWNERS</p>
      <h1 className="text-4xl font-semibold tracking-tight">{TOKEN}</h1>
      <p className="mt-4 max-w-xl leading-relaxed text-muted-foreground">
        {PRODUCT.name} helps students and early-career candidates in {PRODUCT.market} understand how well a
        job description fits their experience. {TOKEN} is how it reads job postings.
      </p>
      <dl className="mt-10 divide-y border-y">
        {FACTS.map((fact) => (
          <div key={fact.title} className="grid gap-2 py-5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-medium">{fact.title}</dt>
            <dd className="text-sm leading-relaxed text-muted-foreground">{fact.body}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="opt-out" className="mt-10 space-y-3">
        <h2 id="opt-out" className="text-lg font-semibold">
          Opting out
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Add this to your robots.txt. It takes effect within an hour: scheduled reads stop, and users will be
          asked to paste the description instead.
        </p>
        <pre className="overflow-x-auto border bg-muted/40 p-4 font-mono text-sm">
          {`User-agent: ${TOKEN}\nDisallow: /`}
        </pre>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Requests identify themselves with a user agent that starts with “{TOKEN}/” and links to this page.
        </p>
      </section>
    </main>
  );
}
