-- AlterTable: הפרדת הקצאת טורקיה IL מ-PS
ALTER TABLE "CashWeekFlow" ADD COLUMN IF NOT EXISTS "turkeyTransferIls" DECIMAL(19,4);
