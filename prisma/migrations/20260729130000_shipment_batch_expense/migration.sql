-- CreateTable
CREATE TABLE "ShipmentBatchExpense" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "notes" TEXT,
    "paymentMethod" TEXT,
    "expenseDate" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentBatchExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentBatchExpense_batchId_idx" ON "ShipmentBatchExpense"("batchId");

-- CreateIndex
CREATE INDEX "ShipmentBatchExpense_expenseDate_idx" ON "ShipmentBatchExpense"("expenseDate");

-- AddForeignKey
ALTER TABLE "ShipmentBatchExpense" ADD CONSTRAINT "ShipmentBatchExpense_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ShipmentBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
