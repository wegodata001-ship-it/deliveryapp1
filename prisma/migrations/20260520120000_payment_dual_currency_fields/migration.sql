-- תשלום דו-מטבעי: צורת תשלום והערה נפרדים לדולר ולשקל
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "usdPaymentMethod" "PaymentMethod";
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "ilsPaymentMethod" "PaymentMethod";
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "usdNote" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "ilsNote" TEXT;
