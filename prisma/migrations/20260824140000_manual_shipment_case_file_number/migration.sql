-- Manual shipment: מספר תיק (case file number)
ALTER TABLE "ManualShipment" ADD COLUMN IF NOT EXISTS "caseFileNumber" TEXT;
