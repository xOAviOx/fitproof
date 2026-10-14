import { z } from "zod";
import { APPLICATION_STATUSES, type ApplicationStatus } from "./vocab";

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const applicationUpdateSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  notes: z
    .string()
    .trim()
    .max(2000, "Keep notes under 2,000 characters.")
    .transform((value) => value || null),
  nextActionAt: z.preprocess(
    (value) => (value === "" ? null : value),
    z.iso.date({ message: "Use a valid date." }).nullable(),
  ),
});
export type ApplicationUpdate = z.infer<typeof applicationUpdateSchema>;
