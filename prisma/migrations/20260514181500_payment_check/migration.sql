-- PaymentCheck: idempotent (handles fresh DB, legacy table without status, and wrong migration order)
DO $init$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentCheckStatus') THEN
    CREATE TYPE "PaymentCheckStatus" AS ENUM ('PENDING', 'DEPOSITED', 'BOUNCED');
  END IF;
END
$init$;

CREATE TABLE IF NOT EXISTS "PaymentCheck" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "checkNumber" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentCheck_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaymentCheck" ADD COLUMN IF NOT EXISTS "status" "PaymentCheckStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "PaymentCheck" ADD COLUMN IF NOT EXISTS "reversalPaymentId" TEXT;

DO $fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCheck_paymentId_fkey') THEN
    ALTER TABLE "PaymentCheck" ADD CONSTRAINT "PaymentCheck_paymentId_fkey"
      FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS "PaymentCheck_paymentId_idx" ON "PaymentCheck"("paymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentCheck_reversalPaymentId_key" ON "PaymentCheck"("reversalPaymentId");
CREATE INDEX IF NOT EXISTS "PaymentCheck_status_idx" ON "PaymentCheck"("status");
CREATE INDEX IF NOT EXISTS "PaymentCheck_dueDate_idx" ON "PaymentCheck"("dueDate");
