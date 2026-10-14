import { describe, expect, it } from "vitest";
import { extractJobPage, htmlToText } from "./extract";

const REQUIREMENTS = Array.from(
  { length: 6 },
  (_, i) => `<li>Requirement number ${i + 1} for this role.</li>`,
).join("");

describe("htmlToText", () => {
  it("keeps one line per block and marks list items", () => {
    expect(
      htmlToText(
        "<h2>About</h2><p>We build <b>payments</b>&nbsp;APIs.<br>Join us.</p><ul><li>Node.js</li><li>SQL</li></ul><script>alert(1)</script>",
      ),
    ).toBe("About\n\nWe build payments APIs.\nJoin us.\n\n- Node.js\n\n- SQL");
  });
});

describe("extractJobPage", () => {
  it("reads schema.org JobPosting data, including @graph and double-escaped HTML", () => {
    const posting = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Acme Careers" },
        {
          "@type": ["JobPosting"],
          title: "Backend Engineer",
          hiringOrganization: { "@type": "Organization", name: "Acme Payments" },
          jobLocation: [
            {
              "@type": "Place",
              address: { addressLocality: "Bengaluru", addressRegion: "KA", addressCountry: "IN" },
            },
            { "@type": "Place", address: "Pune, India" },
          ],
          employmentType: "FULL_TIME",
          description: `&lt;p&gt;Build REST APIs in Node.js.&lt;/p&gt;&lt;ul&gt;${REQUIREMENTS.replaceAll("<", "&lt;").replaceAll(">", "&gt;")}&lt;/ul&gt;`,
        },
      ],
    };
    const page = extractJobPage(
      `<html><head><title>Jobs</title><script type="application/ld+json">${JSON.stringify(posting)}</script></head><body><nav>Menu</nav></body></html>`,
    );
    expect(page?.method).toBe("json_ld");
    expect(page?.title).toBe("Backend Engineer");
    expect(page?.company).toBe("Acme Payments");
    expect(page?.text).toContain(
      "Backend Engineer\nCompany: Acme Payments\nLocation: Bengaluru, KA, IN; Pune, India\nEmployment type: FULL_TIME",
    );
    expect(page?.text).toContain("Build REST APIs in Node.js.");
    expect(page?.text).toContain("- Requirement number 6 for this role.");
    expect(page?.text).not.toContain("&lt;");
  });

  it("skips malformed JSON-LD and falls back to the readable article", () => {
    const paragraphs = Array.from(
      { length: 5 },
      (_, i) =>
        `<p>Paragraph ${i + 1}: you will analyse sales data in SQL and Excel, build dashboards, and present weekly findings to the team.</p>`,
    ).join("");
    const page = extractJobPage(
      `<html><head><title>Data Analyst | Acme</title><script type="application/ld+json">{not json</script></head><body><nav><a href="/">Home</a></nav><article><h1>Data Analyst</h1>${paragraphs}<ul>${REQUIREMENTS}</ul></article><footer>Cookie settings</footer></body></html>`,
    );
    expect(page?.method).toBe("readability");
    expect(page?.title).toBeNull();
    expect(page?.text).toContain("Paragraph 5: you will analyse sales data in SQL and Excel");
    expect(page?.text).not.toContain("Cookie settings");
  });

  it("returns null when there is no content", () => {
    expect(extractJobPage("<html><body></body></html>")).toBeNull();
  });
});
