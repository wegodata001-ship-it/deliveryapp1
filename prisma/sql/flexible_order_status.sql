-- סטטוסי הזמנה גמישים: SourceStatus + Order.status כטקסט (שומר ערכי enum קיימים)

ALTER TABLE "SourceStatus" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SourceStatus" ADD COLUMN IF NOT EXISTS "colorHex" TEXT;

UPDATE "SourceStatus" SET "colorHex" = CASE
  WHEN "color" = 'success' THEN '#22c55e'
  WHEN "color" = 'danger' THEN '#ef4444'
  WHEN "color" = 'warning' THEN '#f97316'
  WHEN "color" = 'info' THEN '#3b82f6'
  ELSE COALESCE("colorHex", '#64748b')
END
WHERE "colorHex" IS NULL OR "colorHex" = '';

-- מחיקת שורות UUID שגויות (לא enum ולא בשימוש)
DELETE FROM "SourceStatus" s
WHERE s."id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."status"::text = s."id" AND o."deletedAt" IS NULL);

-- Order.status → TEXT (שומר OPEN, COMPLETED וכו')
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Order' AND column_name = 'status'
      AND udt_name IN (SELECT typname FROM pg_type WHERE typtype = 'e')
  ) THEN
    ALTER TABLE "Order" ALTER COLUMN "status" TYPE TEXT USING "status"::text;
  END IF;
END $$;
