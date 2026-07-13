-- CreateEnum
CREATE TYPE "TurkeyTransferMovementType" AS ENUM ('CASH_COUNT_ALLOCATION', 'TRANSFER_TO_TURKEY', 'CASH_COUNT_ADJUSTMENT', 'TRANSFER_REVERSAL', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TurkeyTransferCurrency" AS ENUM ('USD', 'ILS');

-- CreateTable
CREATE TABLE "turkey_transfer_movement" (
    "id" TEXT NOT NULL,
    "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR',
    "week_code" TEXT NOT NULL,
    "cash_week_flow_id" TEXT,
    "type" "TurkeyTransferMovementType" NOT NULL,
    "currency" "TurkeyTransferCurrency" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "balance_before" DECIMAL(19,4),
    "balance_after" DECIMAL(19,4),
    "reference" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turkey_transfer_movement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "turkey_transfer_movement_countryCode_week_code_idx" ON "turkey_transfer_movement"("countryCode", "week_code");

-- CreateIndex
CREATE INDEX "turkey_transfer_movement_cash_week_flow_id_idx" ON "turkey_transfer_movement"("cash_week_flow_id");

-- CreateIndex
CREATE INDEX "turkey_transfer_movement_type_idx" ON "turkey_transfer_movement"("type");

-- CreateIndex
CREATE INDEX "turkey_transfer_movement_created_at_idx" ON "turkey_transfer_movement"("created_at");

-- AddForeignKey
ALTER TABLE "turkey_transfer_movement" ADD CONSTRAINT "turkey_transfer_movement_cash_week_flow_id_fkey" FOREIGN KEY ("cash_week_flow_id") REFERENCES "CashWeekFlow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turkey_transfer_movement" ADD CONSTRAINT "turkey_transfer_movement_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: הקצאות מספירות קופה קיימות (turkeyTransferUsd = לטורקיה PS)
INSERT INTO "turkey_transfer_movement" (
    "id",
    "countryCode",
    "week_code",
    "cash_week_flow_id",
    "type",
    "currency",
    "amount",
    "notes",
    "created_at"
)
SELECT
    gen_random_uuid()::text,
    c."countryCode",
    c."weekCode",
    c."id",
    'CASH_COUNT_ALLOCATION'::"TurkeyTransferMovementType",
    'USD'::"TurkeyTransferCurrency",
    c."turkeyTransferUsd",
    'מיגרציה — הקצאה מספירת קופה קיימת',
    COALESCE(c."updatedAt", c."createdAt")
FROM "CashWeekFlow" c
WHERE c."turkeyTransferUsd" IS NOT NULL
  AND c."turkeyTransferUsd" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "turkey_transfer_movement" m
    WHERE m."cash_week_flow_id" = c."id"
      AND m."type" = 'CASH_COUNT_ALLOCATION'
      AND m."currency" = 'USD'
  );
