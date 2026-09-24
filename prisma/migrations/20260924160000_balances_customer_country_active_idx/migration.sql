-- Customer list for יתרות לקוחות: countryCode + isActive + deletedAt
CREATE INDEX IF NOT EXISTS "Customer_countryCode_isActive_deletedAt_idx"
  ON "Customer"("countryCode", "isActive", "deletedAt");
