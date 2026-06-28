-- הוספת שדות מקור חיצוני להזמנה (לייבוא והתאמת מערכות) — בטוח ואידמפוטנטי.
-- אין יצירת טבלה חדשה; הרחבה נקייה של טבלת Order הקיימת בלבד.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "branch" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "collector" TEXT;
CREATE INDEX IF NOT EXISTS "Order_externalOrderId_idx" ON "Order" ("externalOrderId");
