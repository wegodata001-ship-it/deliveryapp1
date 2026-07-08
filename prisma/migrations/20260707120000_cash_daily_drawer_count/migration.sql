-- CreateTable
CREATE TABLE "CashDailyDrawerCount" (
    "id" TEXT NOT NULL,
    "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR',
    "weekCode" TEXT NOT NULL,
    "countDate" TEXT NOT NULL,
    "cashIls" DECIMAL(19,4),
    "cashUsd" DECIMAL(19,4),
    "checksIls" DECIMAL(19,4),
    "creditIls" DECIMAL(19,4),
    "transferIls" DECIMAL(19,4),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashDailyDrawerCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashDailyDrawerCount_weekCode_idx" ON "CashDailyDrawerCount"("weekCode");

-- CreateIndex
CREATE INDEX "CashDailyDrawerCount_countDate_idx" ON "CashDailyDrawerCount"("countDate");

-- CreateIndex
CREATE UNIQUE INDEX "CashDailyDrawerCount_countryCode_weekCode_countDate_key" ON "CashDailyDrawerCount"("countryCode", "weekCode", "countDate");

-- AddForeignKey
ALTER TABLE "CashDailyDrawerCount" ADD CONSTRAINT "CashDailyDrawerCount_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
