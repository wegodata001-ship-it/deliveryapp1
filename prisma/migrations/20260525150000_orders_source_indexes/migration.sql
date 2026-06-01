-- Orders source table — list/filter performance (idempotent)
CREATE INDEX IF NOT EXISTS "Order_customerNameSnapshot_idx"
  ON "Order" ("customerNameSnapshot")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_customerCodeSnapshot_idx"
  ON "Order" ("customerCodeSnapshot")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_createdAt_deletedAt_idx"
  ON "Order" ("createdAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "Order_sourceCountry_deletedAt_idx"
  ON "Order" ("sourceCountry")
  WHERE "deletedAt" IS NULL AND "sourceCountry" IS NOT NULL;

ANALYZE "Order";
