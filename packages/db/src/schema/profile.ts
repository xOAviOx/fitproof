import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, id, ownRowsPolicy, sourceText, timestamptz, updatedAt, userConfirmed } from "./columns";
import { evidenceTierEnum, profileStatusEnum, scoreTypeEnum, skillOriginEnum } from "./enums";
import { resumeFiles } from "./resumes";
import { userId } from "./users";

export type ProfileLink = { label: string; url: string };

/** One per user for now. Contact details live here and are never sent to an LLM or used for matching. */
export const candidateProfiles = pgTable(
  "candidate_profiles",
  {
    id: id(),
    userId: userId(),
    status: profileStatusEnum("status").notNull().default("draft"),
    summary: text("summary"),
    links: jsonb("links").$type<ProfileLink[]>().notNull().default([]),
    sourceResumeFileId: uuid("source_resume_file_id").references(() => resumeFiles.id, {
      onDelete: "set null",
    }),
    confirmedAt: timestamptz("confirmed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("candidate_profiles_user_id_key").on(t.userId), ownRowsPolicy()],
).enableRLS();

const profileId = () =>
  uuid("profile_id")
    .notNull()
    .references(() => candidateProfiles.id, { onDelete: "cascade" });

const sortOrder = () => integer("sort_order").notNull().default(0);

const stringList = (name: string) => jsonb(name).$type<string[]>().notNull().default([]);

export const profileExperiences = pgTable(
  "profile_experiences",
  {
    id: id(),
    userId: userId(),
    profileId: profileId(),
    tier: evidenceTierEnum("tier").notNull().default("paid_work"),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    isCurrent: boolean("is_current").notNull().default(false),
    bullets: stringList("bullets"),
    skills: stringList("skills"),
    sourceText: sourceText(),
    userConfirmed: userConfirmed(),
    sortOrder: sortOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profile_experiences_user_id_idx").on(t.userId),
    index("profile_experiences_profile_id_idx").on(t.profileId),
    ownRowsPolicy(),
  ],
).enableRLS();

export const profileProjects = pgTable(
  "profile_projects",
  {
    id: id(),
    userId: userId(),
    profileId: profileId(),
    tier: evidenceTierEnum("tier").notNull().default("project"),
    name: text("name").notNull(),
    description: text("description"),
    url: text("url"),
    bullets: stringList("bullets"),
    skills: stringList("skills"),
    sourceText: sourceText(),
    userConfirmed: userConfirmed(),
    sortOrder: sortOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profile_projects_user_id_idx").on(t.userId),
    index("profile_projects_profile_id_idx").on(t.profileId),
    ownRowsPolicy(),
  ],
).enableRLS();

export const profileEducation = pgTable(
  "profile_education",
  {
    id: id(),
    userId: userId(),
    profileId: profileId(),
    tier: evidenceTierEnum("tier").notNull().default("coursework_or_certification"),
    institution: text("institution").notNull(),
    degree: text("degree"),
    branch: text("branch"),
    startYear: integer("start_year"),
    graduationYear: integer("graduation_year"),
    scoreType: scoreTypeEnum("score_type"),
    score: numeric("score", { precision: 5, scale: 2 }),
    scoreScale: numeric("score_scale", { precision: 5, scale: 2 }),
    coursework: stringList("coursework"),
    sourceText: sourceText(),
    userConfirmed: userConfirmed(),
    sortOrder: sortOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profile_education_user_id_idx").on(t.userId),
    index("profile_education_profile_id_idx").on(t.profileId),
    ownRowsPolicy(),
  ],
).enableRLS();

export const profileCertifications = pgTable(
  "profile_certifications",
  {
    id: id(),
    userId: userId(),
    profileId: profileId(),
    tier: evidenceTierEnum("tier").notNull().default("coursework_or_certification"),
    name: text("name").notNull(),
    issuer: text("issuer"),
    issuedOn: date("issued_on"),
    skills: stringList("skills"),
    sourceText: sourceText(),
    userConfirmed: userConfirmed(),
    sortOrder: sortOrder(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profile_certifications_user_id_idx").on(t.userId),
    index("profile_certifications_profile_id_idx").on(t.profileId),
    ownRowsPolicy(),
  ],
).enableRLS();

export const profileSkills = pgTable(
  "profile_skills",
  {
    id: id(),
    userId: userId(),
    profileId: profileId(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    tier: evidenceTierEnum("tier").notNull().default("self_declared"),
    origin: skillOriginEnum("origin").notNull().default("resume"),
    sourceText: sourceText(),
    userConfirmed: userConfirmed(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profile_skills_user_id_idx").on(t.userId),
    index("profile_skills_profile_id_idx").on(t.profileId),
    index("profile_skills_normalized_name_idx").on(t.normalizedName),
    ownRowsPolicy(),
  ],
).enableRLS();
