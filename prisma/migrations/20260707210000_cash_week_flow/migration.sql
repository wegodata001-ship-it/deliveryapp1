-- CreateTable
CREATE TABLE "CashWeekFlow" (
    "id" TEXT NOT NULL,
    "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR',
    "weekCode" TEXT NOT NULL,
    "countedCashIls" DECIMAL(19,4),
    "countedCashUsd" DECIMAL(19,4),
    "countedCreditIls" DECIMAL(19,4),
    "countedChecksIls" DECIMAL(19,4),
    "countedTransferIls" DECIMAL(19,4),
    "fxPurchaseIls" DECIMAL(19,4),
    "fxPurchaseUsd" DECIMAL(19,4),
    "turkeyTransferUsd" DECIMAL(19,4),
    "bankBalanceIls" DECIMAL(19,4),
    "bankBalanceUsd" DECIMAL(19,4),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashWeekFlow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashWeekFlow_weekCode_idx" ON "CashWeekFlow"("weekCode");

-- CreateIndex
CREATE UNIQUE INDEX "CashWeekFlow_countryCode_weekCode_key" ON "CashWeekFlow"("countryCode", "weekCode");

-- AddForeignKey
ALTER TABLE "CashWeekFlow" ADD CONSTRAINT "CashWeekFlow_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
