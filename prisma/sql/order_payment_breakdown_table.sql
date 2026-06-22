-- תשלום מורכב: טבלת חלוקת תשלום להזמנה (תוספתי בלבד, ללא נגיעה בטבלאות קיימות).
-- תואם למודל OrderPaymentBreakdown ב-schema.prisma.

CREATE TABLE IF NOT EXISTS "OrderPaymentBreakdown" (
  "id"            TEXT NOT NULL,
  "orderId"       TEXT NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "amount"        DECIMAL(19,4) NOT NULL,
  "currency"      TEXT NOT NULL DEFAULT 'USD',
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderPaymentBreakdown_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderPaymentBreakdown_orderId_idx" ON "OrderPaymentBreakdown" ("orderId");

DO $$ BEGIN
  ALTER TABLE "OrderPaymentBreakdown"
    ADD CONSTRAINT "OrderPaymentBreakdown_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
