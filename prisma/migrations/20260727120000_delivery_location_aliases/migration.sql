-- CreateEnum
CREATE TYPE "LocationMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'MANUALLY_FIXED');

-- AlterTable — אזור חלוקה: קוד + updatedAt
ALTER TABLE "ShipmentDeliveryZone" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "ShipmentDeliveryZone" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable — יישובים מעודכנים
CREATE TABLE IF NOT EXISTS "DeliveryLocation" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "distributionAreaId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable — כינויי יישוב
CREATE TABLE IF NOT EXISTS "DeliveryLocationAlias" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "normalizedOriginalName" TEXT NOT NULL,
    "deliveryLocationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "DeliveryLocationAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable — Audit תיקוני יישוב/אזור
CREATE TABLE IF NOT EXISTS "DeliveryLocationAudit" (
    "id" TEXT NOT NULL,
    "shipmentRecordId" TEXT,
    "deliveryLocationId" TEXT,
    "originalName" TEXT,
    "previousCity" TEXT,
    "newCity" TEXT,
    "previousZoneId" TEXT,
    "newZoneId" TEXT,
    "savedAsPermanentAlias" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryLocationAudit_pkey" PRIMARY KEY ("id")
);

-- AlterTable — שדות התאמת יישוב במשלוח
ALTER TABLE "ShipmentRecord" ADD COLUMN IF NOT EXISTS "originalDeliveryLocation" TEXT;
ALTER TABLE "ShipmentRecord" ADD COLUMN IF NOT EXISTS "deliveryLocationId" TEXT;
ALTER TABLE "ShipmentRecord" ADD COLUMN IF NOT EXISTS "locationMatchStatus" "LocationMatchStatus";

-- Indexes & constraints
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryLocation_displayName_key" ON "DeliveryLocation"("displayName");
CREATE INDEX IF NOT EXISTS "DeliveryLocation_distributionAreaId_idx" ON "DeliveryLocation"("distributionAreaId");
CREATE INDEX IF NOT EXISTS "DeliveryLocation_isActive_idx" ON "DeliveryLocation"("isActive");

CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryLocationAlias_normalizedOriginalName_key" ON "DeliveryLocationAlias"("normalizedOriginalName");
CREATE INDEX IF NOT EXISTS "DeliveryLocationAlias_deliveryLocationId_idx" ON "DeliveryLocationAlias"("deliveryLocationId");
CREATE INDEX IF NOT EXISTS "DeliveryLocationAlias_isActive_idx" ON "DeliveryLocationAlias"("isActive");

CREATE INDEX IF NOT EXISTS "DeliveryLocationAudit_shipmentRecordId_idx" ON "DeliveryLocationAudit"("shipmentRecordId");
CREATE INDEX IF NOT EXISTS "DeliveryLocationAudit_deliveryLocationId_idx" ON "DeliveryLocationAudit"("deliveryLocationId");
CREATE INDEX IF NOT EXISTS "DeliveryLocationAudit_createdAt_idx" ON "DeliveryLocationAudit"("createdAt");

CREATE INDEX IF NOT EXISTS "ShipmentRecord_deliveryLocationId_idx" ON "ShipmentRecord"("deliveryLocationId");
CREATE INDEX IF NOT EXISTS "ShipmentRecord_locationMatchStatus_idx" ON "ShipmentRecord"("locationMatchStatus");

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "DeliveryLocation" ADD CONSTRAINT "DeliveryLocation_distributionAreaId_fkey"
    FOREIGN KEY ("distributionAreaId") REFERENCES "ShipmentDeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DeliveryLocationAlias" ADD CONSTRAINT "DeliveryLocationAlias_deliveryLocationId_fkey"
    FOREIGN KEY ("deliveryLocationId") REFERENCES "DeliveryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "DeliveryLocationAudit" ADD CONSTRAINT "DeliveryLocationAudit_deliveryLocationId_fkey"
    FOREIGN KEY ("deliveryLocationId") REFERENCES "DeliveryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ShipmentRecord" ADD CONSTRAINT "ShipmentRecord_deliveryLocationId_fkey"
    FOREIGN KEY ("deliveryLocationId") REFERENCES "DeliveryLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
