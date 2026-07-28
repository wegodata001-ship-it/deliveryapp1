-- CreateTable
CREATE TABLE "ShipmentCashCount" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "countedIls" DECIMAL(12,2) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShipmentCashCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentCashCount_dayId_idx" ON "ShipmentCashCount"("dayId");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentCashCount_dayId_method_key" ON "ShipmentCashCount"("dayId", "method");

-- AddForeignKey
ALTER TABLE "ShipmentCashCount" ADD CONSTRAINT "ShipmentCashCount_dayId_fkey" FOREIGN KEY ("dayId") REFERENCES "ShipmentCashDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
