ALTER TABLE "companies" ADD COLUMN "ats_region" text;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "facts" jsonb;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "detail_version" text;--> statement-breakpoint
ALTER TABLE "job_postings" ADD COLUMN "posted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "job_postings_company_id_idx" ON "job_postings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "job_postings_open_seen_idx" ON "job_postings" USING btree ("source","closed_at","last_seen_at");--> statement-breakpoint
CREATE INDEX "jobs_canonical_apply_url_idx" ON "jobs" USING btree ("canonical_apply_url");