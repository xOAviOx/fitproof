/**
 * Domain vocabulary shared by the database enums, Zod schemas, and UI.
 * Adding a value here requires a migration (`ALTER TYPE ... ADD VALUE`);
 * removing one requires a data migration first.
 */

export const ROLE_FAMILIES = ["backend", "frontend", "data_analyst"] as const;
export type RoleFamily = (typeof ROLE_FAMILIES)[number];

export const EVIDENCE_TIERS = [
  "paid_work",
  "internship",
  "project",
  "coursework_or_certification",
  "self_declared",
] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export const REQUIREMENT_TYPES = [
  "hard_eligibility",
  "core_skill",
  "nice_to_have",
  "responsibility",
  "unclear",
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const ELIGIBILITY_KINDS = [
  "location",
  "work_authorization",
  "degree",
  "graduation_batch",
  "experience_band",
  "availability",
] as const;
export type EligibilityKind = (typeof ELIGIBILITY_KINDS)[number];

/** India-only for the MVP market. Stored in a text column, so adding a value needs no migration. */
export const WORK_AUTHORIZATION_STATUSES = ["authorized", "needs_sponsorship"] as const;
export type WorkAuthorizationStatus = (typeof WORK_AUTHORIZATION_STATUSES)[number];

/** Ordered lowest to highest; eligibility compares by position. */
export const DEGREE_LEVELS = ["diploma", "bachelor", "master", "doctorate"] as const;
export type DegreeLevel = (typeof DEGREE_LEVELS)[number];

/** `low` is hidden unless the user expands; `excluded` means a known-failed hard requirement. */
export const MATCH_BANDS = ["strong", "good", "partial", "low", "excluded"] as const;
export type MatchBand = (typeof MATCH_BANDS)[number];

export const EXPLANATION_STATUSES = ["none", "pending", "ready", "fallback", "failed"] as const;
export type ExplanationStatus = (typeof EXPLANATION_STATUSES)[number];

export const APPLICATION_STATUSES = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const REMOTE_TYPES = ["onsite", "hybrid", "remote", "unknown"] as const;
export type RemoteType = (typeof REMOTE_TYPES)[number];

export const REMOTE_PREFERENCES = ["onsite", "hybrid", "remote", "any"] as const;
export type RemotePreference = (typeof REMOTE_PREFERENCES)[number];

export const EMPLOYMENT_TYPES = ["internship", "full_time", "contract", "part_time", "unknown"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SENIORITY_LEVELS = ["intern", "entry", "mid", "senior", "lead", "unknown"] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export const ATS_TYPES = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "workday"] as const;
export type AtsType = (typeof ATS_TYPES)[number];

export const JOB_SOURCES = [...ATS_TYPES, "adzuna", "user_paste", "user_url"] as const;
export type JobSource = (typeof JOB_SOURCES)[number];

export const DISMISS_REASONS = [
  "location",
  "seniority",
  "salary",
  "company",
  "role_mismatch",
  "already_applied",
  "other",
] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number];

export const FEEDBACK_KINDS = ["dismiss", "gap_response"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const GAP_RESPONSES = ["has_it", "does_not_have"] as const;
export type GapResponse = (typeof GAP_RESPONSES)[number];

export const TAILORING_TYPES = ["reword", "reorder", "emphasize", "surface_term"] as const;
export type TailoringType = (typeof TAILORING_TYPES)[number];

export const SUGGESTION_STATUSES = ["pending", "accepted", "rejected"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const SKILL_ORIGINS = ["resume", "gap_prompt", "manual"] as const;
export type SkillOrigin = (typeof SKILL_ORIGINS)[number];

export const PROFILE_STATUSES = ["draft", "confirmed"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export const RESUME_FILE_STATUSES = ["uploaded", "extracting", "extracted", "failed"] as const;
export type ResumeFileStatus = (typeof RESUME_FILE_STATUSES)[number];

export const SCORE_TYPES = ["cgpa", "percentage"] as const;
export type ScoreType = (typeof SCORE_TYPES)[number];

export const JOB_RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];

export const PROCESSING_STATUSES = ["pending", "ready", "failed"] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];
