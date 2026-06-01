import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";

export type OrderNumberAllocation = {
  orderNumber: string;
  oldOrderNumber: string;
  sequence: number;
};

async function ensureOrderWeekCounterTable(): Promise<void> {
  await ensureOnce("order-week-counter-table", async () => {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "order_week_counter" (
        "week_code" TEXT NOT NULL,
        "next_number" INTEGER NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "order_week_counter_pkey" PRIMARY KEY ("week_code")
      )
    `;
  });
}

/** סריקת MAX חד-פעמית לשבוע — רק בעת יצירת שורת counter */
async function scanMaxSequenceFromOrders(
  weekCode: string,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<number> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const prefix = `${wc}-`;

  const [numAgg, oldAgg] = await Promise.all([
    db.order.aggregate({
      where: {
        weekCode: wc,
        isActive: true,
        orderNumber: { startsWith: prefix },
      },
      _max: { orderNumber: true },
    }),
    db.order.aggregate({
      where: { weekCode: wc, isActive: true, oldOrderNumber: { not: null } },
      _max: { oldOrderNumber: true },
    }),
  ]);

  let maxSeq = 0;
  const latest = numAgg._max.orderNumber;
  if (latest?.startsWith(prefix)) {
    const suffix = latest.slice(prefix.length);
    if (/^\d{4}$/.test(suffix)) maxSeq = Math.max(maxSeq, parseInt(suffix, 10));
  }
  const oldMax = oldAgg._max.oldOrderNumber?.trim();
  if (oldMax && /^\d{4}$/.test(oldMax)) maxSeq = Math.max(maxSeq, parseInt(oldMax, 10));
  return maxSeq;
}

function formatAllocation(weekCode: string, sequence: number): OrderNumberAllocation {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const suffix = String(sequence).padStart(4, "0");
  return {
    orderNumber: `${wc}-${suffix}`,
    oldOrderNumber: suffix,
    sequence,
  };
}

async function counterRowExists(
  weekCode: string,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ week_code: string }>>`
    SELECT "week_code" FROM "order_week_counter" WHERE "week_code" = ${weekCode} LIMIT 1
  `;
  return rows.length > 0;
}

async function ensureWeekCounterRow(
  weekCode: string,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<void> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  await ensureOrderWeekCounterTable();
  if (await counterRowExists(wc, db)) return;

  const maxSeq = await scanMaxSequenceFromOrders(wc, db);
  try {
    await db.$executeRaw`
      INSERT INTO "order_week_counter" ("week_code", "next_number", "updated_at")
      VALUES (${wc}, ${maxSeq}, CURRENT_TIMESTAMP)
      ON CONFLICT ("week_code") DO NOTHING
    `;
  } catch {
    /* מרוץ */
  }
}

/** הקצאה אטומית — UPDATE counter RETURNING (ללא MAX על Order) */
export async function allocateNextOrderNumberFromCounter(
  weekCode: string,
): Promise<OrderNumberAllocation> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  await ensureOrderWeekCounterTable();

  return prisma.$transaction(async (tx) => {
    await ensureWeekCounterRow(wc, tx);

    const rows = await tx.$queryRaw<Array<{ next_number: number }>>`
      UPDATE "order_week_counter"
      SET "next_number" = "next_number" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "week_code" = ${wc}
      RETURNING "next_number"
    `;

    const sequence = Number(rows[0]?.next_number ?? 1);
    return formatAllocation(wc, sequence);
  });
}

/** תצוגה בלבד — לא מקדם את המונה (ל-preview / next-number API) */
export async function peekNextOrderNumberFromCounter(
  weekCode: string,
): Promise<OrderNumberAllocation> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  await ensureOrderWeekCounterTable();
  await ensureWeekCounterRow(wc, prisma);

  const rows = await prisma.$queryRaw<Array<{ next_number: number }>>`
    SELECT "next_number" FROM "order_week_counter" WHERE "week_code" = ${wc} LIMIT 1
  `;
  const sequence = Number(rows[0]?.next_number ?? 0) + 1;
  return formatAllocation(wc, sequence);
}
