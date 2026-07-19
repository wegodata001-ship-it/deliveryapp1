-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- CreateTable: InventoryItem
CREATE TABLE "InventoryItem" (
    "id"           TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "unit"         TEXT NOT NULL DEFAULT 'יח''',
    "pricePerUnit" DECIMAL(12,4) NOT NULL,
    "currency"     TEXT NOT NULL DEFAULT 'ILS',
    "isActive"     BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"    INTEGER NOT NULL DEFAULT 0,
    "notes"        TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InventoryCount
CREATE TABLE "InventoryCount" (
    "id"          TEXT NOT NULL,
    "weekCode"    TEXT NOT NULL,
    "countDate"   TIMESTAMP(3) NOT NULL,
    "status"      "InventoryCountStatus" NOT NULL DEFAULT 'DRAFT',
    "notes"       TEXT,
    "createdById" TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable: InventoryCountLine
CREATE TABLE "InventoryCountLine" (
    "id"         TEXT NOT NULL,
    "countId"    TEXT NOT NULL,
    "itemId"     TEXT NOT NULL,
    "systemQty"  DECIMAL(12,3) NOT NULL,
    "countedQty" DECIMAL(12,3) NOT NULL,
    "notes"      TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_isActive_idx" ON "InventoryItem"("isActive");

CREATE INDEX "InventoryCount_weekCode_idx"  ON "InventoryCount"("weekCode");
CREATE INDEX "InventoryCount_status_idx"    ON "InventoryCount"("status");

CREATE UNIQUE INDEX "InventoryCountLine_countId_itemId_key" ON "InventoryCountLine"("countId", "itemId");
CREATE INDEX "InventoryCountLine_countId_idx" ON "InventoryCountLine"("countId");
CREATE INDEX "InventoryCountLine_itemId_idx"  ON "InventoryCountLine"("itemId");

-- AddForeignKey
ALTER TABLE "InventoryCount"
    ADD CONSTRAINT "InventoryCount_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryCountLine"
    ADD CONSTRAINT "InventoryCountLine_countId_fkey"
    FOREIGN KEY ("countId") REFERENCES "InventoryCount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryCountLine"
    ADD CONSTRAINT "InventoryCountLine_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
