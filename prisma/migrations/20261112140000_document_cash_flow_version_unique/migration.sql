-- One cash-flow archive version per week and document type.
-- Nullable weekCode/docType/docVersion stay outside the index, so older Document rows remain valid.
-- Idempotent. Does not update or delete existing rows.
-- A real duplicate stops the migration instead of being rewritten.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Document"
    WHERE "weekCode" IS NOT NULL
      AND "docType" IS NOT NULL
      AND "docVersion" IS NOT NULL
    GROUP BY "weekCode", "docType", "docVersion"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate Document version for weekCode, docType, docVersion';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Document_cash_flow_version_uidx"
  ON "Document" ("weekCode", "docType", "docVersion")
  WHERE "weekCode" IS NOT NULL
    AND "docType" IS NOT NULL
    AND "docVersion" IS NOT NULL;
