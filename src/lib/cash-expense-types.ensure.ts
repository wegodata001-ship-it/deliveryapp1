import "server-only";

import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { CASH_EXPENSE_TYPE_SEED } from "@/lib/cash-expense-types";

export async function ensureCashExpenseDirectionColumn(): Promise<void> {
  await ensureOnce("cash-expense-direction-column", async () => {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "CashExpense" ADD COLUMN IF NOT EXISTS "direction" TEXT`,
    );
  });
  await ensureOnce("cash-expense-direction-check", async () => {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'CashExpense_direction_check'
        ) THEN
          ALTER TABLE "CashExpense"
            ADD CONSTRAINT "CashExpense_direction_check"
            CHECK ("direction" IS NULL OR "direction" IN ('EXPENSE', 'INCOME'));
        END IF;
      END $$;
    `);
  });
}

export async function ensureCashExpenseTypesTable(): Promise<void> {
  await ensureCashExpenseDirectionColumn();
  await ensureOnce("cash-expense-type-table", async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CashExpenseType" (
        "id" TEXT NOT NULL,
        "code" TEXT NOT NULL,
        "label" TEXT NOT NULL,
        "isActive" BOOLEAN NOT NULL DEFAULT true,
        "isSystem" BOOLEAN NOT NULL DEFAULT false,
        "sortOrder" INTEGER NOT NULL DEFAULT 0,
        "createdById" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CashExpenseType_pkey" PRIMARY KEY ("id")
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "CashExpenseType_code_key" ON "CashExpenseType"("code")`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "CashExpenseType_isActive_sortOrder_idx" ON "CashExpenseType"("isActive", "sortOrder")`,
    );

    for (const row of CASH_EXPENSE_TYPE_SEED) {
      const id = `cet-seed-${row.code.toLowerCase()}`;
      await prisma.$executeRaw`
        INSERT INTO "CashExpenseType" ("id", "code", "label", "isActive", "isSystem", "sortOrder", "createdAt", "updatedAt")
        VALUES (${id}, ${row.code}, ${row.label}, true, true, ${row.sortOrder}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("code") DO NOTHING
      `;
    }
  });
}
