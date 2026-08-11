-- Manual shipment: payment amount input for computed «תשלום» column
ALTER TABLE "ManualShipment" ADD COLUMN IF NOT EXISTS "paymentAmount" DECIMAL(19,4);
