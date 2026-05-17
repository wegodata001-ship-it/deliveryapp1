-- אחוז עמלה גלובלי (ברירת מחדל לקליטת הזמנה / תצוגה בקליטת תשלום)
ALTER TABLE "FinancialSettings"
ADD COLUMN IF NOT EXISTS "defaultCommissionPercent" DECIMAL(7, 4) NOT NULL DEFAULT 0;
