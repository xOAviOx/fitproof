-- pgvector powers job/profile embedding retrieval. On Supabase it can also be
-- enabled from the dashboard; this keeps plain-Postgres hosts working too.
CREATE EXTENSION IF NOT EXISTS vector;
