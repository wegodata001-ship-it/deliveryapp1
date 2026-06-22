-- תוספת בלבד: שמירת מטבע/סכום המקור לכל תשלום (ללא נגיעה בשדות קיימים).
-- תואם למודל Payment ב-schema.prisma.

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "sourceCurrency" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "sourceAmount" DECIMAL(19,4);
