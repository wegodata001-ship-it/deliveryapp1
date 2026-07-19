CREATE TYPE "PaymentBusinessType" AS ENUM (
  'STANDARD',
  'CUSTOMER_CREDIT',
  'CREDIT_APPLICATION',
  'BALANCE_RESET',
  'ADJUSTMENT_FEE'
);

ALTER TABLE "Payment"
ADD COLUMN "businessType" "PaymentBusinessType" NOT NULL DEFAULT 'STANDARD';

-- סיווג חד-פעמי של נתונים היסטוריים. לאחר המיגרציה קוד היישום משתמש רק בשדה המובנה.
UPDATE "Payment"
SET "businessType" = 'CUSTOMER_CREDIT'
WHERE "orderId" IS NULL
  AND "notes" LIKE 'יתרת זכות ללקוח — עודף מתשלום%';

UPDATE "Payment"
SET "businessType" = 'CREDIT_APPLICATION'
WHERE "notes" LIKE '%קיזוז יתרת זכות לסגירת הזמנה%'
   OR "notes" LIKE '%איפוס יתרה מתוך יתרת זכות%';

UPDATE "Payment"
SET "businessType" = 'BALANCE_RESET'
WHERE "notes" LIKE '%איפוס יתרה%';

UPDATE "Payment"
SET "businessType" = 'ADJUSTMENT_FEE'
WHERE "notes" LIKE '[PAYMENT_ADJUSTMENT_FEE]%';

CREATE INDEX "Payment_businessType_idx" ON "Payment"("businessType");

CREATE TABLE "payment_method_allocation" (
  "id" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "sourceAmount" DECIMAL(19,4) NOT NULL,
  "amountUsd" DECIMAL(19,4) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_method_allocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_method_allocation_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "payment_method_allocation_paymentId_idx"
ON "payment_method_allocation"("paymentId");

CREATE INDEX "payment_method_allocation_method_idx"
ON "payment_method_allocation"("method");

CREATE INDEX "payment_method_allocation_currency_idx"
ON "payment_method_allocation"("currency");

-- Backfill structured details for historical single-method rows.
INSERT INTO "payment_method_allocation" (
  "id", "paymentId", "method", "currency", "sourceAmount", "amountUsd"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  COALESCE(p."usdPaymentMethod", p."paymentMethod", 'OTHER'),
  'USD',
  p."amountUsd",
  p."amountUsd"
FROM "Payment" p
WHERE p."amountUsd" IS NOT NULL
  AND p."amountUsd" <> 0
  AND COALESCE(p."usdPaymentMethod", p."paymentMethod", 'OTHER') <> 'OTHER';

INSERT INTO "payment_method_allocation" (
  "id", "paymentId", "method", "currency", "sourceAmount", "amountUsd"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  COALESCE(p."ilsPaymentMethod", p."paymentMethod", 'OTHER'),
  'ILS',
  p."amountIls",
  CASE
    WHEN p."exchangeRate" IS NOT NULL AND p."exchangeRate" > 0
      THEN p."amountIls" / p."exchangeRate"
    ELSE 0
  END
FROM "Payment" p
WHERE p."amountIls" IS NOT NULL
  AND p."amountIls" <> 0
  AND COALESCE(p."ilsPaymentMethod", p."paymentMethod", 'OTHER') <> 'OTHER';
