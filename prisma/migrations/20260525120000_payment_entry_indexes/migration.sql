-- Payment entry + navigation (idempotent)
CREATE INDEX IF NOT EXISTS "Payment_customerId_createdAt_idx"
  ON "Payment" ("customerId", "createdAt" DESC)
  WHERE "customerId" IS NOT NULL;

ANALYZE "Payment";
ANALYZE "Customer";
