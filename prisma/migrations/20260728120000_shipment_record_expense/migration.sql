-- CreateTable
CREATE TABLE "ShipmentRecordExpense" (
    "id" TEXT NOT NULL,
    "shipmentRecordId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountIls" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "expenseDate" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentRecordExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentRecordExpense_shipmentRecordId_idx" ON "ShipmentRecordExpense"("shipmentRecordId");

-- CreateIndex
CREATE INDEX "ShipmentRecordExpense_expenseDate_idx" ON "ShipmentRecordExpense"("expenseDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShipmentRecord_customerCode_idx" ON "ShipmentRecord"("customerCode");

-- AddForeignKey
ALTER TABLE "ShipmentRecordExpense" ADD CONSTRAINT "ShipmentRecordExpense_shipmentRecordId_fkey" FOREIGN KEY ("shipmentRecordId") REFERENCES "ShipmentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
