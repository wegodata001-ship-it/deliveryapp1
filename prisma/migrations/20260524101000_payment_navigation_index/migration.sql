-- ניווט קליטת תשלום prev/next לפי paymentNumber
CREATE INDEX IF NOT EXISTS "Payment_nav_paymentNumber_idx"
ON "Payment" ("paymentNumber")
WHERE "customerId" IS NOT NULL AND "paymentCode" IS NOT NULL;
