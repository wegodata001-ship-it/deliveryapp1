-- Customers source table — list/filter performance (idempotent)
CREATE INDEX IF NOT EXISTS "Customer_isActive_createdAt_idx"
  ON "Customer" ("isActive", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Customer_city_idx"
  ON "Customer" ("city")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Customer_createdAt_idx"
  ON "Customer" ("createdAt" DESC)
  WHERE "deletedAt" IS NULL;

ANALYZE "Customer";
