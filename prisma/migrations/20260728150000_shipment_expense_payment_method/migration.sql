-- AlterTable: add paymentMethod to ShipmentRecordExpense
ALTER TABLE "ShipmentRecordExpense" ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'CASH';
