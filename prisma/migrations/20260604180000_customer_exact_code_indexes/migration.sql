-- Fast exact customer code lookup by work country (payment intake / search-fast)
CREATE INDEX IF NOT EXISTS "Customer_countryCode_customerCode_active_idx"
  ON "Customer" ("countryCode", "customerCode")
  WHERE "deletedAt" IS NULL AND "isActive" = true;

CREATE INDEX IF NOT EXISTS "Customer_countryCode_oldCustomerCode_active_idx"
  ON "Customer" ("countryCode", "oldCustomerCode")
  WHERE "deletedAt" IS NULL AND "isActive" = true AND "oldCustomerCode" IS NOT NULL;

ANALYZE "Customer";
