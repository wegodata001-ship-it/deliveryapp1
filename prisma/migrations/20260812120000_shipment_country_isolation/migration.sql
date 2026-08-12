-- Shipment module country isolation — historical data defaults to TR (Turkey)

-- ShipmentBatch
ALTER TABLE "ShipmentBatch" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
DROP INDEX IF EXISTS "ShipmentBatch_batchNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentBatch_countryCode_batchNumber_key" ON "ShipmentBatch"("countryCode", "batchNumber");
CREATE INDEX IF NOT EXISTS "ShipmentBatch_countryCode_idx" ON "ShipmentBatch"("countryCode");

-- ShipmentDeliveryZone
ALTER TABLE "ShipmentDeliveryZone" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
DROP INDEX IF EXISTS "ShipmentDeliveryZone_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentDeliveryZone_countryCode_name_key" ON "ShipmentDeliveryZone"("countryCode", "name");
CREATE INDEX IF NOT EXISTS "ShipmentDeliveryZone_countryCode_idx" ON "ShipmentDeliveryZone"("countryCode");

-- DeliveryLocation
ALTER TABLE "DeliveryLocation" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
DROP INDEX IF EXISTS "DeliveryLocation_displayName_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryLocation_countryCode_displayName_key" ON "DeliveryLocation"("countryCode", "displayName");
CREATE INDEX IF NOT EXISTS "DeliveryLocation_countryCode_idx" ON "DeliveryLocation"("countryCode");

-- DeliveryLocationAlias
ALTER TABLE "DeliveryLocationAlias" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
UPDATE "DeliveryLocationAlias" a
SET "countryCode" = l."countryCode"
FROM "DeliveryLocation" l
WHERE a."deliveryLocationId" = l."id";
DROP INDEX IF EXISTS "DeliveryLocationAlias_normalizedOriginalName_key";
CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryLocationAlias_countryCode_normalizedOriginalName_key"
  ON "DeliveryLocationAlias"("countryCode", "normalizedOriginalName");
CREATE INDEX IF NOT EXISTS "DeliveryLocationAlias_countryCode_idx" ON "DeliveryLocationAlias"("countryCode");

-- ShipmentCourier
ALTER TABLE "ShipmentCourier" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
DROP INDEX IF EXISTS "ShipmentCourier_name_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentCourier_countryCode_name_key" ON "ShipmentCourier"("countryCode", "name");
CREATE INDEX IF NOT EXISTS "ShipmentCourier_countryCode_idx" ON "ShipmentCourier"("countryCode");

-- ShipmentCashDay
ALTER TABLE "ShipmentCashDay" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
DROP INDEX IF EXISTS "ShipmentCashDay_dayDate_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ShipmentCashDay_countryCode_dayDate_key" ON "ShipmentCashDay"("countryCode", "dayDate");
CREATE INDEX IF NOT EXISTS "ShipmentCashDay_countryCode_idx" ON "ShipmentCashDay"("countryCode");

-- ManualShipment — backfill from legacy text where unambiguous
ALTER TABLE "ManualShipment" ADD COLUMN IF NOT EXISTS "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR';
UPDATE "ManualShipment"
SET "countryCode" = 'CN'::"WorkCountryCode"
WHERE "country" ILIKE '%סין%' OR "country" ILIKE '%china%' OR "country" ILIKE '%cn%';
UPDATE "ManualShipment"
SET "countryCode" = 'AE'::"WorkCountryCode"
WHERE "country" ILIKE '%אמיר%' OR "country" ILIKE '%uae%' OR "country" ILIKE '%emirates%';
CREATE INDEX IF NOT EXISTS "ManualShipment_countryCode_idx" ON "ManualShipment"("countryCode");
