-- Arabic display name for courier PDFs (deliveryLocationArabic)
ALTER TABLE "DeliveryLocation" ADD COLUMN IF NOT EXISTS "displayNameAr" TEXT;
