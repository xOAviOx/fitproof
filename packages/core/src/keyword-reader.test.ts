import { describe, expect, it } from "vitest";
import { cleanJobText, verifyJobExtraction } from "./jobs";
import { keywordJobExtraction } from "./keyword-reader";

const POSTING = cleanJobText(`Frontend Developer

Requirements
- Strong JavaScript and TypeScript skills.
- 2+ years building React apps; Next.js experience is a plus.
- Comfortable with HTML, CSS, Git, REST APIs, and unit testing with Jest.
- Fluent with DSA, OOP, Docker, Kubernetes, AWS, PostgreSQL, C++, C#, and .NET.

Nice to have
- Tailwind CSS
- Power BI dashboards or Excel

About us
We build payments software and value accessibility, statistics, and machine learning.`);

describe("keyword reader", () => {
  const raw = keywordJobExtraction(POSTING);
  const verified = verifyJobExtraction(raw, POSTING);

  it("finds known skills, each quoted by the line that names it", () => {
    expect(verified.validityRate).toBe(1);
    const skills = verified.job.requirements.map((item) => item.skill);
    expect(skills).toEqual(raw.requirements.map((item) => item.skill));
    expect(skills).toEqual(
      expect.arrayContaining([
        "javascript",
        "typescript",
        "react",
        "nextjs",
        "jest",
        "cpp",
        "csharp",
        "dotnet",
      ]),
    );
    expect(new Set(skills).size).toBe(skills.length);
    expect(verified.job.requirements.find((item) => item.skill === "react")?.quote).toBe(
      "2+ years building React apps; Next.js experience is a plus.",
    );
  });

  it("marks skills under a nice-to-have heading or with optional wording as nice to have", () => {
    const type = (skill: string) => verified.job.requirements.find((item) => item.skill === skill)?.type;
    expect(type("javascript")).toBe("core_skill");
    expect(type("react")).toBe("core_skill");
    expect(type("nextjs")).toBe("nice_to_have");
    expect(type("tailwind")).toBe("nice_to_have");
    expect(type("powerbi")).toBe("nice_to_have");
    expect(type("statistics")).toBe("core_skill");
  });

  it("never invents eligibility or responsibilities", () => {
    expect(verified.job.requirements.every((item) => item.type !== "hard_eligibility")).toBe(true);
    expect(verified.job.requirements.every((item) => item.type !== "responsibility")).toBe(true);
    expect(keywordJobExtraction("We are a friendly team.").requirements).toEqual([]);
  });
});
