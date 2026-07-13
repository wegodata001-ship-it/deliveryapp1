-- ספירת קופה יומית — ערוצי USD נוספים (העברה / אשראי / צ'קים / אחר)
ALTER TABLE "CashDailyDrawerCount" ADD COLUMN IF NOT EXISTS "transferUsd" DECIMAL(19,4);
ALTER TABLE "CashDailyDrawerCount" ADD COLUMN IF NOT EXISTS "creditUsd" DECIMAL(19,4);
ALTER TABLE "CashDailyDrawerCount" ADD COLUMN IF NOT EXISTS "checksUsd" DECIMAL(19,4);
ALTER TABLE "CashDailyDrawerCount" ADD COLUMN IF NOT EXISTS "otherUsd" DECIMAL(19,4);
