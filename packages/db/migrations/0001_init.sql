CREATE TYPE "public"."application_status" AS ENUM('saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."ats_type" AS ENUM('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'workday');--> statement-breakpoint
CREATE TYPE "public"."dismiss_reason" AS ENUM('location', 'seniority', 'salary', 'company', 'role_mismatch', 'already_applied', 'other');--> statement-breakpoint
CREATE TYPE "public"."eligibility_kind" AS ENUM('location', 'work_authorization', 'degree', 'graduation_batch', 'experience_band');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('internship', 'full_time', 'contract', 'part_time', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."evidence_tier" AS ENUM('paid_work', 'internship', 'project', 'coursework_or_certification', 'self_declared');--> statement-breakpoint
CREATE TYPE "public"."explanation_status" AS ENUM('none', 'pending', 'ready', 'fallback', 'failed');--> statement-breakpoint
CREATE TYPE "public"."feedback_kind" AS ENUM('dismiss', 'gap_response');--> statement-breakpoint
CREATE TYPE "public"."gap_response" AS ENUM('has_it', 'does_not_have');--> statement-breakpoint
CREATE TYPE "public"."job_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_source" AS ENUM('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'workday', 'adzuna', 'user_paste', 'user_url');--> statement-breakpoint
CREATE TYPE "public"."match_band" AS ENUM('strong', 'good', 'partial', 'low', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."remote_preference" AS ENUM('onsite', 'hybrid', 'remote', 'any');--> statement-breakpoint
CREATE TYPE "public"."remote_type" AS ENUM('onsite', 'hybrid', 'remote', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."requirement_type" AS ENUM('hard_eligibility', 'core_skill', 'nice_to_have', 'responsibility', 'unclear');--> statement-breakpoint
CREATE TYPE "public"."resume_file_status" AS ENUM('uploaded', 'extracting', 'extracted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."role_family" AS ENUM('backend', 'frontend', 'data_analyst');--> statement-breakpoint
CREATE TYPE "public"."score_type" AS ENUM('cgpa', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."seniority" AS ENUM('intern', 'entry', 'mid', 'senior', 'lead', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."skill_origin" AS ENUM('resume', 'gap_prompt', 'manual');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tailoring_type" AS ENUM('reword', 'reorder', 'emphasize', 'surface_term');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid,
	"job_title" text NOT NULL,
	"company_name" text NOT NULL,
	"apply_url" text,
	"status" "application_status" DEFAULT 'saved' NOT NULL,
	"resume_version_id" uuid,
	"applied_at" timestamp with time zone,
	"notes" text,
	"next_action_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_user_job_key" UNIQUE("user_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "saved_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_jobs_user_job_key" UNIQUE("user_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "saved_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tailoring_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"application_id" uuid,
	"result_version_id" uuid,
	"type" "tailoring_type" NOT NULL,
	"target_ref" text NOT NULL,
	"before" text NOT NULL,
	"after" text NOT NULL,
	"rationale" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tailoring_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"ats_type" "ats_type",
	"board_token" text,
	"careers_url" text,
	"hq" text,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug"),
	CONSTRAINT "companies_ats_board_key" UNIQUE("ats_type","board_token")
);
--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_duplicates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"posting_id" uuid NOT NULL,
	"similarity" real NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_duplicates_posting_key" UNIQUE("posting_id")
);
--> statement-breakpoint
ALTER TABLE "job_duplicates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_embeddings" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "job_source" NOT NULL,
	"source_job_id" text NOT NULL,
	"company_id" uuid,
	"job_id" uuid,
	"source_url" text,
	"apply_url" text,
	"title" text NOT NULL,
	"company_name" text NOT NULL,
	"location_text" text,
	"description_text" text NOT NULL,
	"raw" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_postings_source_key" UNIQUE("source","source_job_id")
);
--> statement-breakpoint
ALTER TABLE "job_postings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"type" "requirement_type" NOT NULL,
	"text" text NOT NULL,
	"quote" text NOT NULL,
	"normalized_skill" text,
	"eligibility_kind" "eligibility_kind",
	"eligibility_value" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"company_id" uuid,
	"company_name" text NOT NULL,
	"title" text NOT NULL,
	"normalized_company" text NOT NULL,
	"normalized_title" text NOT NULL,
	"normalized_location" text DEFAULT '' NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remote_type" "remote_type" DEFAULT 'unknown' NOT NULL,
	"employment_type" "employment_type" DEFAULT 'unknown' NOT NULL,
	"seniority" "seniority" DEFAULT 'unknown' NOT NULL,
	"role_family" "role_family",
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"salary_period" text,
	"apply_url" text,
	"canonical_apply_url" text,
	"source" "job_source" NOT NULL,
	"source_name" text NOT NULL,
	"source_url" text,
	"description_text" text NOT NULL,
	"content_hash" text NOT NULL,
	"simhash" text,
	"requirements_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "match_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" "feedback_kind" NOT NULL,
	"dismiss_reason" "dismiss_reason",
	"gap_response" "gap_response",
	"requirement_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"band" "match_band" NOT NULL,
	"score" real NOT NULL,
	"score_breakdown" jsonb NOT NULL,
	"explanation" jsonb,
	"explanation_status" "explanation_status" DEFAULT 'none' NOT NULL,
	"profile_hash" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_user_job_key" UNIQUE("user_id","job_id")
);
--> statement-breakpoint
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_embeddings_profile_kind_key" UNIQUE("profile_id","kind")
);
--> statement-breakpoint
ALTER TABLE "profile_embeddings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "connector_cursors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" text NOT NULL,
	"scope" text NOT NULL,
	"cursor" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_cursors_key" UNIQUE("connector","scope")
);
--> statement-breakpoint
ALTER TABLE "connector_cursors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" "job_run_status" DEFAULT 'queued' NOT NULL,
	"user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"purpose" text NOT NULL,
	"response" jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "llm_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_pkey" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"desired_roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"locations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remote_preference" "remote_preference" DEFAULT 'any' NOT NULL,
	"min_annual_salary_inr" integer,
	"notice_period_days" integer,
	"available_from" date,
	"willing_to_relocate" boolean,
	"employment_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"graduation_year" integer,
	"degree" text,
	"branch" text,
	"score_type" "score_type",
	"score" numeric(5, 2),
	"score_scale" numeric(5, 2),
	"work_authorization" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "candidate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "profile_status" DEFAULT 'draft' NOT NULL,
	"summary" text,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_resume_file_id" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "candidate_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"tier" "evidence_tier" DEFAULT 'coursework_or_certification' NOT NULL,
	"name" text NOT NULL,
	"issuer" text,
	"issued_on" date,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_text" text DEFAULT '' NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_certifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_education" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"tier" "evidence_tier" DEFAULT 'coursework_or_certification' NOT NULL,
	"institution" text NOT NULL,
	"degree" text,
	"branch" text,
	"start_year" integer,
	"graduation_year" integer,
	"score_type" "score_type",
	"score" numeric(5, 2),
	"score_scale" numeric(5, 2),
	"coursework" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_text" text DEFAULT '' NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_education" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"tier" "evidence_tier" DEFAULT 'paid_work' NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_text" text DEFAULT '' NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_experiences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"tier" "evidence_tier" DEFAULT 'project' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text,
	"bullets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_text" text DEFAULT '' NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profile_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"tier" "evidence_tier" DEFAULT 'self_declared' NOT NULL,
	"origin" "skill_origin" DEFAULT 'resume' NOT NULL,
	"source_text" text DEFAULT '' NOT NULL,
	"user_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resume_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"status" "resume_file_status" DEFAULT 'uploaded' NOT NULL,
	"extracted_text" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resume_files_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
ALTER TABLE "resume_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "resume_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid,
	"base_version_id" uuid,
	"job_id" uuid,
	"label" text NOT NULL,
	"content" jsonb NOT NULL,
	"rendered_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_version_id_resume_versions_id_fk" FOREIGN KEY ("resume_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_jobs" ADD CONSTRAINT "saved_jobs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailoring_suggestions" ADD CONSTRAINT "tailoring_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailoring_suggestions" ADD CONSTRAINT "tailoring_suggestions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailoring_suggestions" ADD CONSTRAINT "tailoring_suggestions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tailoring_suggestions" ADD CONSTRAINT "tailoring_suggestions_result_version_id_resume_versions_id_fk" FOREIGN KEY ("result_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_duplicates" ADD CONSTRAINT "job_duplicates_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_duplicates" ADD CONSTRAINT "job_duplicates_posting_id_job_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."job_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_embeddings" ADD CONSTRAINT "job_embeddings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_feedback" ADD CONSTRAINT "match_feedback_requirement_id_job_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."job_requirements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_embeddings" ADD CONSTRAINT "profile_embeddings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_embeddings" ADD CONSTRAINT "profile_embeddings_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_cache" ADD CONSTRAINT "llm_cache_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_source_resume_file_id_resume_files_id_fk" FOREIGN KEY ("source_resume_file_id") REFERENCES "public"."resume_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_certifications" ADD CONSTRAINT "profile_certifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_certifications" ADD CONSTRAINT "profile_certifications_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_education" ADD CONSTRAINT "profile_education_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_education" ADD CONSTRAINT "profile_education_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_experiences" ADD CONSTRAINT "profile_experiences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_experiences" ADD CONSTRAINT "profile_experiences_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_projects" ADD CONSTRAINT "profile_projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_projects" ADD CONSTRAINT "profile_projects_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_files" ADD CONSTRAINT "resume_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_base_version_id_resume_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_job_id_idx" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "saved_jobs_job_id_idx" ON "saved_jobs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "tailoring_suggestions_user_id_idx" ON "tailoring_suggestions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tailoring_suggestions_job_id_idx" ON "tailoring_suggestions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_duplicates_job_id_idx" ON "job_duplicates" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_embeddings_hnsw_idx" ON "job_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "job_postings_job_id_idx" ON "job_postings" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_requirements_job_id_idx" ON "job_requirements" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_owner_user_id_idx" ON "jobs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "jobs_company_id_idx" ON "jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "jobs_content_hash_idx" ON "jobs" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("normalized_company","normalized_title");--> statement-breakpoint
CREATE INDEX "match_feedback_user_id_idx" ON "match_feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "match_feedback_job_id_idx" ON "match_feedback" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "matches_job_id_idx" ON "matches" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "profile_embeddings_user_id_idx" ON "profile_embeddings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "job_runs_status_scheduled_idx" ON "job_runs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "job_runs_kind_created_idx" ON "job_runs" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "job_runs_user_id_idx" ON "job_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "llm_cache_user_id_idx" ON "llm_cache" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preferences_user_id_key" ON "preferences" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_profiles_user_id_key" ON "candidate_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_certifications_user_id_idx" ON "profile_certifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_certifications_profile_id_idx" ON "profile_certifications" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_education_user_id_idx" ON "profile_education" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_education_profile_id_idx" ON "profile_education" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_experiences_user_id_idx" ON "profile_experiences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_experiences_profile_id_idx" ON "profile_experiences" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_projects_user_id_idx" ON "profile_projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_projects_profile_id_idx" ON "profile_projects" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_skills_user_id_idx" ON "profile_skills" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "profile_skills_profile_id_idx" ON "profile_skills" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "profile_skills_normalized_name_idx" ON "profile_skills" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "resume_files_user_id_idx" ON "resume_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "resume_versions_user_id_idx" ON "resume_versions" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "own_rows" ON "applications" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "saved_jobs" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "tailoring_suggestions" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "authenticated_read" ON "companies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "authenticated_read" ON "job_duplicates" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from public.jobs j where j.id = job_duplicates.job_id));--> statement-breakpoint
CREATE POLICY "authenticated_read" ON "job_requirements" AS PERMISSIVE FOR SELECT TO "authenticated" USING (exists (select 1 from public.jobs j where j.id = job_requirements.job_id));--> statement-breakpoint
CREATE POLICY "authenticated_read" ON "jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (owner_user_id is null or owner_user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "match_feedback" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "matches" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "profile_embeddings" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "select_own" ON "job_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "preferences" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "candidate_profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "profile_certifications" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "profile_education" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "profile_experiences" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "profile_projects" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "profile_skills" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "resume_files" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "own_rows" ON "resume_versions" AS PERMISSIVE FOR ALL TO "authenticated" USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "select_own" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING (id = (select auth.uid()));