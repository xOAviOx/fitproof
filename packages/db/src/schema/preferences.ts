import type { EmploymentType, RoleFamily } from "@repo/core";
import { boolean, date, integer, jsonb, numeric, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, ownRowsPolicy, updatedAt } from "./columns";
import { remotePreferenceEnum, scoreTypeEnum } from "./enums";
import { userId } from "./users";

/**
 * Search preferences and eligibility. One row per user for now; dropping
 * `preferences_user_id_key` and keying on `name` enables multiple search profiles later.
 */
export const preferences = pgTable(
  "preferences",
  {
    id: id(),
    userId: userId(),
    name: text("name").notNull().default("Default"),
    desiredRoles: jsonb("desired_roles").$type<RoleFamily[]>().notNull().default([]),
    locations: jsonb("locations").$type<string[]>().notNull().default([]),
    remotePreference: remotePreferenceEnum("remote_preference").notNull().default("any"),
    minAnnualSalaryInr: integer("min_annual_salary_inr"),
    noticePeriodDays: integer("notice_period_days"),
    availableFrom: date("available_from"),
    willingToRelocate: boolean("willing_to_relocate"),
    employmentTypes: jsonb("employment_types").$type<EmploymentType[]>().notNull().default([]),
    graduationYear: integer("graduation_year"),
    degree: text("degree"),
    branch: text("branch"),
    scoreType: scoreTypeEnum("score_type"),
    score: numeric("score", { precision: 5, scale: 2 }),
    scoreScale: numeric("score_scale", { precision: 5, scale: 2 }),
    workAuthorization: text("work_authorization"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("preferences_user_id_key").on(t.userId), ownRowsPolicy()],
).enableRLS();
