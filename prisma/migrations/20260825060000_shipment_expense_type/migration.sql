-- CreateTable
CREATE TABLE "ShipmentExpenseType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentExpenseType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentExpenseType_code_key" ON "ShipmentExpenseType"("code");

-- CreateIndex
CREATE INDEX "ShipmentExpenseType_isActive_sortOrder_idx" ON "ShipmentExpenseType"("isActive", "sortOrder");

-- Seed existing system expense types (do not alter/delete historical categories)
INSERT INTO "ShipmentExpenseType" ("id", "code", "label", "isActive", "isSystem", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('set-fuel-000000000000000000000001', 'FUEL', 'דלק', true, true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('set-road6-00000000000000000000002', 'ROAD6', 'כביש 6', true, true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('set-parking-000000000000000000003', 'PARKING', 'חניה', true, true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('set-port-000000000000000000000004', 'PORT', 'נמל', true, true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('set-storage-000000000000000000005', 'STORAGE', 'אחסנה', true, true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('set-unload-0000000000000000000006', 'UNLOADING', 'פריקה', true, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('set-transport-0000000000000000007', 'TRANSPORT', 'הובלה', true, true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('set-refund-0000000000000000000008', 'CUSTOMER_REFUND', 'החזר ללקוח', true, true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('set-other-00000000000000000000009', 'OTHER', 'אחר', true, true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
