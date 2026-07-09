-- בקרת תזרים: עמודות חדשות בלבד על CashWeekFlow (תוספתי, ללא מחיקות).

ALTER TABLE "CashWeekFlow" ADD COLUMN IF NOT EXISTS "commissionUsd" DECIMAL(19,4);
ALTER TABLE "CashWeekFlow" ADD COLUMN IF NOT EXISTS "commissionIls" DECIMAL(19,4);
ALTER TABLE "CashWeekFlow" ADD COLUMN IF NOT EXISTS "fxRemainderCashIls" DECIMAL(19,4);
ALTER TABLE "CashWeekFlow" ADD COLUMN IF NOT EXISTS "fxRemainderBankIls" DECIMAL(19,4);
ALTER TABLE "CashWeekFlow" ADD COLUMN IF NOT EXISTS "fxPurchases" JSONB;
