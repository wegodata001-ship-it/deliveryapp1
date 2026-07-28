-- CreateEnum
CREATE TYPE "ShipmentCashDayStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShipmentCashDay" (
    "id" TEXT NOT NULL,
    "dayDate" DATE NOT NULL,
    "status" "ShipmentCashDayStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "openedById" TEXT,
    "closedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentCashDay_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ShipmentCashExpense" (
    "id" TEXT NOT NULL,
    "dayId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amountIls" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentCashExpense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentCashDay_dayDate_key" ON "ShipmentCashDay"("dayDate");
CREATE INDEX IF NOT EXISTS "ShipmentCashDay_status_idx" ON "ShipmentCashDay"("status");
CREATE INDEX IF NOT EXISTS "ShipmentCashDay_dayDate_idx" ON "ShipmentCashDay"("dayDate");
CREATE INDEX IF NOT EXISTS "ShipmentCashExpense_dayId_idx" ON "ShipmentCashExpense"("dayId");
CREATE INDEX IF NOT EXISTS "ShipmentCashExpense_createdAt_idx" ON "ShipmentCashExpense"("createdAt");

DO $$ BEGIN
  ALTER TABLE "ShipmentCashExpense" ADD CONSTRAINT "ShipmentCashExpense_dayId_fkey"
    FOREIGN KEY ("dayId") REFERENCES "ShipmentCashDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
