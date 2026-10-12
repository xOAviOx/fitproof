import {
  APPLICATION_STATUSES,
  ATS_TYPES,
  DISMISS_REASONS,
  ELIGIBILITY_KINDS,
  EMPLOYMENT_TYPES,
  EVIDENCE_TIERS,
  EXPLANATION_STATUSES,
  FEEDBACK_KINDS,
  GAP_RESPONSES,
  JOB_RUN_STATUSES,
  JOB_SOURCES,
  MATCH_BANDS,
  PROCESSING_STATUSES,
  PROFILE_STATUSES,
  REMOTE_PREFERENCES,
  REMOTE_TYPES,
  REQUIREMENT_TYPES,
  RESUME_FILE_STATUSES,
  ROLE_FAMILIES,
  SCORE_TYPES,
  SENIORITY_LEVELS,
  SKILL_ORIGINS,
  SUGGESTION_STATUSES,
  TAILORING_TYPES,
} from "@repo/core";
import { pgEnum } from "drizzle-orm/pg-core";

export const roleFamilyEnum = pgEnum("role_family", ROLE_FAMILIES);
export const evidenceTierEnum = pgEnum("evidence_tier", EVIDENCE_TIERS);
export const requirementTypeEnum = pgEnum("requirement_type", REQUIREMENT_TYPES);
export const eligibilityKindEnum = pgEnum("eligibility_kind", ELIGIBILITY_KINDS);
export const matchBandEnum = pgEnum("match_band", MATCH_BANDS);
export const explanationStatusEnum = pgEnum("explanation_status", EXPLANATION_STATUSES);
export const applicationStatusEnum = pgEnum("application_status", APPLICATION_STATUSES);
export const remoteTypeEnum = pgEnum("remote_type", REMOTE_TYPES);
export const remotePreferenceEnum = pgEnum("remote_preference", REMOTE_PREFERENCES);
export const employmentTypeEnum = pgEnum("employment_type", EMPLOYMENT_TYPES);
export const seniorityEnum = pgEnum("seniority", SENIORITY_LEVELS);
export const atsTypeEnum = pgEnum("ats_type", ATS_TYPES);
export const jobSourceEnum = pgEnum("job_source", JOB_SOURCES);
export const dismissReasonEnum = pgEnum("dismiss_reason", DISMISS_REASONS);
export const feedbackKindEnum = pgEnum("feedback_kind", FEEDBACK_KINDS);
export const gapResponseEnum = pgEnum("gap_response", GAP_RESPONSES);
export const tailoringTypeEnum = pgEnum("tailoring_type", TAILORING_TYPES);
export const suggestionStatusEnum = pgEnum("suggestion_status", SUGGESTION_STATUSES);
export const skillOriginEnum = pgEnum("skill_origin", SKILL_ORIGINS);
export const profileStatusEnum = pgEnum("profile_status", PROFILE_STATUSES);
export const resumeFileStatusEnum = pgEnum("resume_file_status", RESUME_FILE_STATUSES);
export const scoreTypeEnum = pgEnum("score_type", SCORE_TYPES);
export const jobRunStatusEnum = pgEnum("job_run_status", JOB_RUN_STATUSES);
export const processingStatusEnum = pgEnum("processing_status", PROCESSING_STATUSES);
