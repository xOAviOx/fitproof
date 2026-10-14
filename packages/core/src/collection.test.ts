import { describe, expect, it } from "vitest";
import {
  assessPosting,
  describeCoverage,
  employmentTypeFrom,
  looksExpired,
  readLocation,
  roleFamilyFromTitle,
  seniorityFromTitle,
} from "./collection";

describe("roleFamilyFromTitle", () => {
  it.each([
    ["Software Engineer", "backend"],
    ["SDE-1, Payments", "backend"],
    ["Backend Developer (Node.js)", "backend"],
    ["Full Stack Engineer - React/Node", "backend"],
    ["Java Developer", "backend"],
    ["Member of Technical Staff", "backend"],
    ["Frontend Engineer", "frontend"],
    ["Front-End Developer", "frontend"],
    ["React Developer", "frontend"],
    ["UI Engineer", "frontend"],
    ["Data Analyst", "data_analyst"],
    ["Business Intelligence Analyst", "data_analyst"],
    ["Product Analyst - Growth", "data_analyst"],
    ["Analytics Engineer", "data_analyst"],
  ] as const)("reads %s as %s", (title, family) => {
    expect(roleFamilyFromTitle(title)).toBe(family);
  });

  it.each([
    "SDET",
    "QA Engineer",
    "DevOps Engineer",
    "Site Reliability Engineer",
    "Android Developer",
    "Software Engineer, iOS",
    "React Native Developer",
    "Data Engineer",
    "Data Scientist",
    "Machine Learning Engineer",
    "Solutions Engineer",
    "Customer Success Manager",
    "Product Designer",
    "Account Executive",
    "Financial Analyst",
    "Developer Advocate",
  ])("leaves %s out of the three families", (title) => {
    expect(roleFamilyFromTitle(title)).toBeNull();
  });
});

describe("seniorityFromTitle", () => {
  it.each([
    ["Senior Software Engineer", "senior"],
    ["Sr. Frontend Developer", "senior"],
    ["Staff Engineer", "senior"],
    ["Software Engineer III", "senior"],
    ["FBS Agile Dev Team Member V - Java Full Stack", "senior"],
    ["Agile Dev Team Member III : .Net Core Full Stack Developer", "senior"],
    ["SDE 3", "senior"],
    ["Engineering Manager", "lead"],
    ["Tech Lead, Backend", "lead"],
    ["Associate Director, Analytics", "lead"],
    ["Software Engineering Intern", "intern"],
    ["Graduate Engineer Trainee", "entry"],
    ["Associate Software Engineer", "entry"],
    ["Software Engineer I", "entry"],
    ["SDE-1", "entry"],
    ["Software Engineer II", "mid"],
    ["Software Engineer", "unknown"],
  ] as const)("reads %s as %s", (title, level) => {
    expect(seniorityFromTitle(title)).toBe(level);
  });

  it("falls back to the source's experience label, ignoring Mid-Senior", () => {
    expect(seniorityFromTitle("Data Analyst", "Entry level")).toBe("entry");
    expect(seniorityFromTitle("Data Analyst", "Director")).toBe("lead");
    expect(seniorityFromTitle("Data Analyst", "Mid-Senior level")).toBe("unknown");
  });
});

describe("employmentTypeFrom", () => {
  it("reads common ATS values and the title", () => {
    expect(employmentTypeFrom(["FullTime"], "Engineer")).toBe("full_time");
    expect(employmentTypeFrom(["full time"], "Engineer")).toBe("full_time");
    expect(employmentTypeFrom(["permanent"], "Engineer")).toBe("full_time");
    expect(employmentTypeFrom(["Contract"], "Engineer")).toBe("contract");
    expect(employmentTypeFrom(["PartTime"], "Engineer")).toBe("part_time");
    expect(employmentTypeFrom(["Full-time"], "Data Analyst Intern")).toBe("internship");
    expect(employmentTypeFrom([null, undefined], "Engineer")).toBe("unknown");
  });
});

describe("readLocation", () => {
  it("finds target cities, India, and the work mode", () => {
    expect(readLocation({ texts: ["Bengaluru, Karnataka, India"] })).toEqual({
      cities: ["Bengaluru"],
      targetCities: ["Bengaluru"],
      india: true,
      remoteType: "unknown",
    });
    expect(readLocation({ texts: ["Remote - India"] })).toMatchObject({ india: true, remoteType: "remote" });
    expect(readLocation({ texts: ["Gachibowli"], workplace: ["Hybrid"] })).toMatchObject({
      targetCities: ["Hyderabad"],
      remoteType: "hybrid",
    });
    expect(readLocation({ texts: ["Remote"], countryCodes: ["IN"], workplace: ["remote"] })).toMatchObject({
      india: true,
      remoteType: "remote",
    });
    expect(readLocation({ texts: ["Mumbai"], workplace: ["on_site"] })).toMatchObject({
      targetCities: [],
      india: true,
      remoteType: "onsite",
    });
    expect(readLocation({ texts: ["Remote - US"] })).toMatchObject({ india: false, remoteType: "remote" });
  });
});

describe("assessPosting", () => {
  it("keeps early-career roles in target cities or India-remote", () => {
    expect(
      assessPosting({
        title: "Software Engineer I",
        location: { texts: ["Bangalore, India; Mumbai, India"] },
        employmentHints: ["Full-time"],
      }),
    ).toEqual({
      keep: true,
      roleFamily: "backend",
      seniority: "entry",
      employmentType: "full_time",
      remoteType: "unknown",
      locations: ["Bengaluru", "Mumbai"],
    });
    expect(
      assessPosting({ title: "Data Analyst", location: { texts: ["India"], workplace: [true] } }),
    ).toMatchObject({ keep: true, locations: ["Remote"], remoteType: "remote" });
  });

  it("says why a posting is skipped", () => {
    const place = { texts: ["Pune"] };
    expect(assessPosting({ title: "Software Engineer", location: { texts: ["London"] } })).toEqual({
      keep: false,
      reason: "location",
    });
    expect(assessPosting({ title: "Software Engineer", location: { texts: ["India"] } })).toEqual({
      keep: false,
      reason: "location",
    });
    expect(assessPosting({ title: "Software Engineer", location: { texts: ["Remote"] } })).toEqual({
      keep: false,
      reason: "location",
    });
    expect(assessPosting({ title: "Account Executive", location: place })).toEqual({
      keep: false,
      reason: "role",
    });
    expect(assessPosting({ title: "Senior Data Analyst", location: place })).toEqual({
      keep: false,
      reason: "seniority",
    });
  });
});

describe("looksExpired", () => {
  it("recognizes closed-posting wording only", () => {
    expect(looksExpired("Sorry, this job is no longer accepting applications.")).toBe(true);
    expect(looksExpired("The position has been filled.")).toBe(true);
    expect(looksExpired("This job has expired")).toBe(true);
    expect(looksExpired("We are no longer a small team. Apply now!")).toBe(false);
  });
});

describe("describeCoverage", () => {
  it("says nothing until a recent run succeeded", () => {
    expect(describeCoverage({ companies: 0, adzuna: false })).toBeNull();
  });

  it("names the sources, the places, and the board cadence", () => {
    expect(describeCoverage({ companies: 84, adzuna: true })).toBe(
      "Covering 84 company career boards and Adzuna listings for Bengaluru, Hyderabad, Pune, and remote roles in India. Company boards are re-read every 6 hours.",
    );
    expect(describeCoverage({ companies: 1, adzuna: false })).toMatch(/^Covering 1 company career board for/);
    expect(describeCoverage({ companies: 0, adzuna: true })).toBe(
      "Covering Adzuna listings for Bengaluru, Hyderabad, Pune, and remote roles in India.",
    );
  });
});
