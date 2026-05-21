-- מדינת לקוח (תווית עברית)
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "country" TEXT;
CREATE INDEX IF NOT EXISTS "Customer_country_idx" ON "Customer" ("country");
