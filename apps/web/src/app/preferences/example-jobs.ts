import type { HardRequirement, JobFacts } from "@repo/core";

export type ExampleJob = { id: string; title: string; company: string; summary: string; job: JobFacts };

const requirement = <K extends HardRequirement["kind"]>(
  kind: K,
  quote: string,
  value: Extract<HardRequirement, { kind: K }>["value"],
) => ({ kind, quote, value }) as HardRequirement;

/** Made-up postings that show how the real filters treat the current preferences. Not real jobs. */
export const EXAMPLE_JOBS: ExampleJob[] = [
  {
    id: "new-grad-backend",
    title: "Backend Engineer, New Grad",
    company: "Example Payments",
    summary: "Bengaluru · Hybrid · Full-time · ₹8–12 LPA",
    job: {
      roleFamily: "backend",
      locations: ["Bengaluru, Karnataka"],
      remoteType: "hybrid",
      employmentType: "full_time",
      salary: { min: 800_000, max: 1_200_000, currency: "INR", period: "year" },
      requirements: [
        requirement("graduation_batch", "Open to 2025 and 2026 graduates.", { years: [2025, 2026] }),
        requirement("degree", "B.E./B.Tech in Computer Science, IT, or a related field.", {
          levels: [],
          degrees: ["B.E.", "B.Tech"],
          fields: ["Computer Science", "IT"],
          allowRelated: true,
          minScores: [],
        }),
        requirement("experience_band", "0–1 years of experience.", { minYears: 0, maxYears: 1 }),
      ],
    },
  },
  {
    id: "frontend-intern",
    title: "Frontend Developer Intern",
    company: "Example Studio",
    summary: "Remote · Internship · Stipend",
    job: {
      roleFamily: "frontend",
      locations: ["India"],
      remoteType: "remote",
      employmentType: "internship",
      salary: { min: 25_000, max: 30_000, currency: "INR", period: "month" },
      requirements: [
        requirement(
          "work_authorization",
          "Candidates must be authorized to work in India; we can't sponsor visas.",
          { country: "IN", sponsorshipAvailable: false },
        ),
        requirement("availability", "You must be able to join within 30 days.", {
          joinWithinDays: 30,
          startBy: null,
        }),
      ],
    },
  },
  {
    id: "data-analyst",
    title: "Data Analyst",
    company: "Example Retail",
    summary: "Hyderabad · Office · Full-time · ₹4–5 LPA",
    job: {
      roleFamily: "data_analyst",
      locations: ["Hyderabad"],
      remoteType: "onsite",
      employmentType: "full_time",
      salary: { min: 400_000, max: 500_000, currency: "INR", period: "year" },
      requirements: [
        requirement("degree", "Minimum 60% or 6.5 CGPA throughout your academics.", {
          levels: [],
          degrees: [],
          fields: [],
          allowRelated: false,
          minScores: [
            { type: "percentage", value: 60, scale: 100 },
            { type: "cgpa", value: 6.5, scale: 10 },
          ],
        }),
      ],
    },
  },
  {
    id: "junior-backend",
    title: "Junior Backend Developer",
    company: "Example Health",
    summary: "Bengaluru · Work mode and job type not stated",
    job: {
      roleFamily: "backend",
      locations: ["Bangalore"],
      remoteType: "unknown",
      employmentType: "unknown",
      salary: null,
      requirements: [
        requirement("location", "This role requires you to be based in Bengaluru.", {
          cities: ["Bengaluru"],
          relocationAccepted: false,
        }),
      ],
    },
  },
  {
    id: "senior-sde",
    title: "Software Engineer II",
    company: "Example Cloud",
    summary: "Pune · Hybrid · Full-time",
    job: {
      roleFamily: "backend",
      locations: ["Pune"],
      remoteType: "hybrid",
      employmentType: "full_time",
      salary: null,
      requirements: [
        requirement("experience_band", "3+ years of professional software development experience.", {
          minYears: 3,
          maxYears: null,
        }),
      ],
    },
  },
  {
    id: "contract-backend",
    title: "Backend Developer (Contract)",
    company: "Example Logistics",
    summary: "Chennai · Office · Contract",
    job: {
      roleFamily: "backend",
      locations: ["Chennai"],
      remoteType: "onsite",
      employmentType: "contract",
      salary: null,
      requirements: [],
    },
  },
];
