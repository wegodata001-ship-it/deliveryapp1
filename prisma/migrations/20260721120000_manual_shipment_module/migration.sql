-- CreateTable
CREATE TABLE "ManualShipment" (
    "id" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3),
    "monthKey" TEXT,
    "country" TEXT,
    "shipmentNumber" TEXT,
    "containerNumber" TEXT,
    "shipmentDetails" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "city" TEXT,
    "orderNumber" TEXT,
    "boxes" INTEGER,
    "totalWeight" DECIMAL(12,3),
    "releaseDate" TIMESTAMP(3),
    "warehouseReceiptDate" TIMESTAMP(3),
    "shippingDate" TIMESTAMP(3),
    "arrivalDate" TIMESTAMP(3),
    "distributionStartDate" TIMESTAMP(3),
    "amountTotal" DECIMAL(19,4),
    "amountPaid" DECIMAL(19,4),
    "amountRemaining" DECIMAL(19,4),
    "internalCode" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ManualShipment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualShipment_shipmentNumber_idx" ON "ManualShipment"("shipmentNumber");
CREATE INDEX "ManualShipment_containerNumber_idx" ON "ManualShipment"("containerNumber");
CREATE INDEX "ManualShipment_country_idx" ON "ManualShipment"("country");
CREATE INDEX "ManualShipment_monthKey_idx" ON "ManualShipment"("monthKey");
CREATE INDEX "ManualShipment_status_idx" ON "ManualShipment"("status");
CREATE INDEX "ManualShipment_entryDate_idx" ON "ManualShipment"("entryDate");
CREATE INDEX "ManualShipment_deletedAt_idx" ON "ManualShipment"("deletedAt");
