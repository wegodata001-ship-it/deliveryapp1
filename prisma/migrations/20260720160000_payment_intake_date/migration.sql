-- Payment Intake Date — used by Cash Control only (actual cash receipt day).
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "intakeDate" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Payment_intakeDate_idx" ON "Payment"("intakeDate");
