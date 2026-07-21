-- AlterTable — עמודות Excel נוספות למשלוח ידני (ללא שינוי שמות קיימים)
ALTER TABLE "ManualShipment" ADD COLUMN "cpm" TEXT;
ALTER TABLE "ManualShipment" ADD COLUMN "vatAmount" DECIMAL(19,4);
ALTER TABLE "ManualShipment" ADD COLUMN "airjetInvoice" TEXT;
ALTER TABLE "ManualShipment" ADD COLUMN "makasa" TEXT;
ALTER TABLE "ManualShipment" ADD COLUMN "makasaNumber" TEXT;
ALTER TABLE "ManualShipment" ADD COLUMN "inlandHaulage" DECIMAL(19,4);
ALTER TABLE "ManualShipment" ADD COLUMN "portHaulage" DECIMAL(19,4);
