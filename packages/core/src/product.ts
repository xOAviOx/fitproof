import type { RoleFamily } from "./vocab";

/** The single place the product name and market scope are defined. */
export const PRODUCT = {
  name: "Fitwise",
  promise: "Find jobs that fit your experience, and know what to improve before you apply.",
  market: "India",
  cities: ["Bengaluru", "Hyderabad", "Pune"],
  includesRemote: true,
} as const;

export const ROLE_FAMILY_LABELS: Record<RoleFamily, string> = {
  backend: "Backend / Software Developer",
  frontend: "Frontend Developer",
  data_analyst: "Data Analyst",
};
