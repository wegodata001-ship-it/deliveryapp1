-- בקרת קופה: טבלאות חדשות בלבד (תוספתי, ללא נגיעה בטבלאות קיימות).
-- תואם למודלים CashExpense / CashCount ב-schema.prisma.

CREATE TABLE IF NOT EXISTS "CashExpense" (
  "id"          TEXT NOT NULL,
  "countryCode" "WorkCountryCode" NOT NULL DEFAULT 'TR',
  "weekCode"    TEXT,
  "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "currency"    TEXT NOT NULL DEFAULT 'ILS',
  "amount"      DECIMAL(19,4) NOT NULL,
  "reason"      TEXT NOT NULL DEFAULT 'OTHER',
  "notes"       TEXT,
  "status"      "PaymentRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashExpense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CashExpense_countryCode_idx" ON "CashExpense" ("countryCode");
CREATE INDEX IF NOT EXISTS "CashExpense_weekCode_idx" ON "CashExpense" ("weekCode");
CREATE INDEX IF NOT EXISTS "CashExpense_expenseDate_idx" ON "CashExpense" ("expenseDate");
CREATE INDEX IF NOT EXISTS "CashExpense_status_idx" ON "CashExpense" ("status");

CREATE TABLE IF NOT EXISTS "CashCount" (
  "id"             TEXT NOT NULL,
  "countryCode"    "WorkCountryCode" NOT NULL DEFAULT 'TR',
  "weekCode"       TEXT,
  "countedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expectedIls"    DECIMAL(19,4) NOT NULL DEFAULT 0,
  "expectedUsd"    DECIMAL(19,4) NOT NULL DEFAULT 0,
  "countedIls"     DECIMAL(19,4) NOT NULL DEFAULT 0,
  "countedUsd"     DECIMAL(19,4) NOT NULL DEFAULT 0,
  "diffIls"        DECIMAL(19,4) NOT NULL DEFAULT 0,
  "diffUsd"        DECIMAL(19,4) NOT NULL DEFAULT 0,
  "notes"          TEXT,
  "varianceNote"   TEXT,
  "varianceStatus" TEXT NOT NULL DEFAULT 'OPEN',
  "createdById"    TEXT,
  "approvedById"   TEXT,
  "approvedAt"     TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CashCount_countryCode_idx" ON "CashCount" ("countryCode");
CREATE INDEX IF NOT EXISTS "CashCount_weekCode_idx" ON "CashCount" ("weekCode");
CREATE INDEX IF NOT EXISTS "CashCount_countedAt_idx" ON "CashCount" ("countedAt");

DO $$ BEGIN
  ALTER TABLE "CashExpense"
    ADD CONSTRAINT "CashExpense_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CashCount"
    ADD CONSTRAINT "CashCount_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CashCount"
    ADD CONSTRAINT "CashCount_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
