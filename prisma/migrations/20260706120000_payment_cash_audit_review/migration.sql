-- סימון "נבדק" בביקורת קופה — פר קליטת תשלום + שבוע (ללא שינוי נתוני קליטה)
CREATE TABLE IF NOT EXISTS "PaymentCashAuditReview" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "weekCode" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    CONSTRAINT "PaymentCashAuditReview_pkey" PRIMARY KEY ("id")
);

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCashAuditReview_paymentId_fkey') THEN
    ALTER TABLE "PaymentCashAuditReview" ADD CONSTRAINT "PaymentCashAuditReview_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCashAuditReview_reviewedById_fkey') THEN
    ALTER TABLE "PaymentCashAuditReview" ADD CONSTRAINT "PaymentCashAuditReview_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$fk$;

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentCashAuditReview_paymentId_weekCode_key"
  ON "PaymentCashAuditReview"("paymentId", "weekCode");
CREATE INDEX IF NOT EXISTS "PaymentCashAuditReview_weekCode_idx" ON "PaymentCashAuditReview"("weekCode");
CREATE INDEX IF NOT EXISTS "PaymentCashAuditReview_paymentId_idx" ON "PaymentCashAuditReview"("paymentId");
