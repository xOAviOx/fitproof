import type { RoleFamily } from "./vocab";

/** The single place the product name and market scope are defined. */
export const PRODUCT = {
  name: "Fitwise",
  promise: "Find jobs that fit your experience, and know what to improve before you apply.",
  market: "India",
  cities: ["Bengaluru", "Hyderabad", "Pune"],
  includesRemote: true,
} as const;

/** Our crawler's robots.txt token. The version changes when what the bot fetches changes. */
export const BOT = { token: `${PRODUCT.name}Bot`, version: "0.4" } as const;

/** The User-Agent for every automated request, linking to the page that explains the bot. */
export const botUserAgent = (siteUrl: string) =>
  `${BOT.token}/${BOT.version} (+${new URL("/bot", siteUrl).href})`;

export const ROLE_FAMILY_LABELS: Record<RoleFamily, string> = {
  backend: "Backend / Software Developer",
  frontend: "Frontend Developer",
  data_analyst: "Data Analyst",
};
