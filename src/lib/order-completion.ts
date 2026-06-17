import { ensureOnce } from "@/lib/ensure-tables-once";
import { prisma } from "@/lib/prisma";

/** עמודה תפעולית בלבד: הזמנה מוכנה שהסתיימה בפועל. לא משפיעה על יתרות/דוחות. */
export async function ensureOrderCompletionColumnOnce(): Promise<void> {
  await ensureOnce("order-is-completed-column", async () => {
    await prisma.$executeRaw`
      ALTER TABLE "Order"
      ADD COLUMN IF NOT EXISTS "isCompleted" BOOLEAN NOT NULL DEFAULT FALSE
    `;
    await prisma.$executeRaw`
      CREATE INDEX IF NOT EXISTS "Order_isCompleted_idx" ON "Order" ("isCompleted")
    `;
  });
}
