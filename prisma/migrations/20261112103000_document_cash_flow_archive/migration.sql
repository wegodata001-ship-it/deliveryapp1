-- Document archive columns for weekly cash-flow snapshots.
-- Nullable on purpose: existing Document rows stay valid and are not backfilled.
-- Idempotent so a database that already received prisma/sql/document_cash_flow_archive.sql can replay this migration.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "weekCode" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "docVersion" INTEGER;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "snapshot" JSONB;

CREATE INDEX IF NOT EXISTS "Document_week_docType_idx" ON "Document" ("weekCode", "docType");
