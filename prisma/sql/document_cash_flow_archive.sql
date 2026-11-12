-- עמודות ארכיון על טבלת Document הקיימת. לא יוצרות טבלת מסמכים נוספת.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "weekCode" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "docVersion" INTEGER;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "snapshot" JSONB;

CREATE INDEX IF NOT EXISTS "Document_week_docType_idx" ON "Document" ("weekCode", "docType");
