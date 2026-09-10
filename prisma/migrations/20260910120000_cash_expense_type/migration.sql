-- CreateTable
CREATE TABLE "CashExpenseType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashExpenseType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashExpenseType_code_key" ON "CashExpenseType"("code");
CREATE INDEX "CashExpenseType_isActive_sortOrder_idx" ON "CashExpenseType"("isActive", "sortOrder");

-- Seed existing hardcoded cash-expense reasons. Do not rewrite historical CashExpense.reason values.
INSERT INTO "CashExpenseType" ("id", "code", "label", "isActive", "isSystem", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('cet-fuel-00000000000000000000001', 'FUEL', 'דלק', true, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-parking-00000000000000000002', 'PARKING', 'חניה', true, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-toll-00000000000000000000003', 'TOLL', 'כביש 6', true, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-food-00000000000000000000004', 'FOOD', 'אוכל/שתייה לעבודה', true, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-equip-0000000000000000000005', 'EQUIPMENT', 'ציוד', true, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-courier-00000000000000000006', 'COURIER', 'שליחויות', true, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-repair-000000000000000000007', 'REPAIR', 'תיקון', true, true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-other-0000000000000000000008', 'OTHER', 'אחר', true, true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-supplier-0000000000000000009', 'SUPPLIER', 'ספק', true, true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cet-purchase-0000000000000000010', 'PURCHASE', 'קנייה', true, true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
