import { describe, expect, it } from "vitest";
import { findSkills, mentionsSkill, normalizeSkillText, skillKey, skillLabel } from "./skills";

describe("skill vocabulary", () => {
  it("keeps C++, C#, and .NET distinct from C and plain words", () => {
    expect(normalizeSkillText("C++, C# and .NET Core")).toBe("cpp csharp and dotnet core");
    expect(normalizeSkillText("C and Python")).toBe("c and python");
    expect(normalizeSkillText("ASP.NET MVC")).toBe("asp net mvc");
    expect(findSkills("Strong C++ (STL) and ASP.NET")).toEqual(expect.arrayContaining(["cpp", "dotnet"]));
  });

  it("finds known skills by any common spelling", () => {
    expect(findSkills("Built with ReactJS, Node.js and Postgres").sort()).toEqual([
      "nodejs",
      "postgresql",
      "react",
    ]);
    expect(findSkills("JavaScript and TypeScript")).not.toContain("java");
    expect(findSkills("Let's go build something")).toEqual([]);
  });

  it("gives one comparison key per skill name", () => {
    expect(skillKey("ReactJS")).toBe("react");
    expect(skillKey("React.js")).toBe("react");
    expect(skillKey("C++")).toBe("cpp");
    expect(skillKey("Golang")).toBe("go");
    expect(skillKey("Go")).toBe("go");
    expect(skillKey("React Native")).toBe("react native");
    expect(skillKey("Apache Spark")).toBe("apache spark");
  });

  it("matches mentions on whole words only", () => {
    expect(mentionsSkill("Wrote services in Golang", "go")).toBe(true);
    expect(mentionsSkill("Ready to go live", "go")).toBe(false);
    expect(mentionsSkill("Ran jobs on Apache Spark", "apache spark")).toBe(true);
    expect(mentionsSkill("A sparkling record", "spark")).toBe(false);
    expect(mentionsSkill("anything", "")).toBe(false);
  });

  it("labels known keys and falls back for others", () => {
    expect(skillLabel("nodejs", "node")).toBe("Node.js");
    expect(skillLabel("apache spark", "Apache Spark")).toBe("Apache Spark");
  });
});
