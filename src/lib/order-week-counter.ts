import type { Prisma, WorkCountryCode as PrismaWorkCountryCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";
import {
  DEFAULT_WORK_COUNTRY,
  formatOrderNumber,
  orderCounterKey,
  weekNumericPart,
  type WorkCountryCode,
} from "@/lib/work-country";

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

function orderNumberPrefixes(workCountry: WorkCountryCode, weekCode: string): string[] {
  const wn = weekNumericPart(weekCode);
  const modern = `${workCountry}-${wn}-`;
  if (workCountry === "TR") {
    return [modern, `AH-${wn}-`, `${weekCode.trim()}-`];
  }
  return [modern];
}

function parseSeqFromOrderNumber(orderNumber: string, prefixes: string[]): number {
  const n = orderNumber.trim().toUpperCase();
  for (const p of prefixes) {
    if (n.startsWith(p.toUpperCase())) {
      const suffix = n.slice(p.length);
      if (/^\d{4}$/.test(suffix)) return parseInt(suffix, 10);
    }
  }
  return 0;
}

/** סריקת MAX חד-פעמית לשבוע+מדינה */
async function scanMaxSequenceFromOrders(
  workCountry: WorkCountryCode,
  weekCode: string,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<number> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const prefixes = orderNumberPrefixes(workCountry, wc);
  const wn = weekNumericPart(wc);

  const [numAgg, legacyAgg, oldAgg] = await Promise.all([
    db.order.aggregate({
      where: {
        countryCode: workCountry as PrismaWorkCountryCode,
        weekCode: wc,
        isActive: true,
        OR: prefixes.map((p) => ({ orderNumber: { startsWith: p } })),
      },
      _max: { orderNumber: true },
    }),
    workCountry === "TR"
      ? db.order.aggregate({
          where: {
            weekCode: wc,
            isActive: true,
            orderNumber: { startsWith: `AH-${wn}-` },
          },
          _max: { orderNumber: true },
        })
      : Promise.resolve({ _max: { orderNumber: null as string | null } }),
    db.order.aggregate({
      where: {
        countryCode: workCountry as PrismaWorkCountryCode,
        weekCode: wc,
        isActive: true,
        oldOrderNumber: { not: null },
      },
      _max: { oldOrderNumber: true },
    }),
  ]);

  let maxSeq = 0;
  for (const agg of [numAgg, legacyAgg]) {
    const latest = agg._max.orderNumber;
    if (latest) maxSeq = Math.max(maxSeq, parseSeqFromOrderNumber(latest, prefixes));
  }
  const oldMax = oldAgg._max.oldOrderNumber?.trim();
  if (oldMax && /^\d{4}$/.test(oldMax)) maxSeq = Math.max(maxSeq, parseInt(oldMax, 10));
  return maxSeq;
}

function formatAllocation(
  workCountry: WorkCountryCode,
  weekCode: string,
  sequence: number,
): OrderNumberAllocation {
  const suffix = String(sequence).padStart(4, "0");
  return {
    orderNumber: formatOrderNumber(workCountry, weekCode, sequence),
    oldOrderNumber: suffix,
    sequence,
  };
}

async function counterRowExists(
  counterKey: string,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ week_code: string }>>`
    SELECT "week_code" FROM "order_week_counter" WHERE "week_code" = ${counterKey} LIMIT 1
  `;
  return rows.length > 0;
}

async function ensureWeekCounterRow(
  workCountry: WorkCountryCode,
  weekCode: string,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<void> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const key = orderCounterKey(workCountry, wc);
  await ensureOrderWeekCounterTable();
  if (await counterRowExists(key, db)) return;

  const maxSeq = await scanMaxSequenceFromOrders(workCountry, wc, db);
  try {
    await db.$executeRaw`
      INSERT INTO "order_week_counter" ("week_code", "next_number", "updated_at")
      VALUES (${key}, ${maxSeq}, CURRENT_TIMESTAMP)
      ON CONFLICT ("week_code") DO NOTHING
    `;
  } catch {
    /* מרוץ */
  }
}

/** הקצאה אטומית — מונה לפי מדינה+שבוע */
export async function allocateNextOrderNumberFromCounter(
  weekCode: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<OrderNumberAllocation> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const key = orderCounterKey(workCountry, wc);
  await ensureOrderWeekCounterTable();

  return prisma.$transaction(async (tx) => {
    await ensureWeekCounterRow(workCountry, wc, tx);

    const rows = await tx.$queryRaw<Array<{ next_number: number }>>`
      UPDATE "order_week_counter"
      SET "next_number" = "next_number" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "week_code" = ${key}
      RETURNING "next_number"
    `;

    const sequence = Number(rows[0]?.next_number ?? 1);
    return formatAllocation(workCountry, wc, sequence);
  });
}

export async function peekNextOrderNumberFromCounter(
  weekCode: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<OrderNumberAllocation> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const key = orderCounterKey(workCountry, wc);
  await ensureOrderWeekCounterTable();
  await ensureWeekCounterRow(workCountry, wc, prisma);

  const rows = await prisma.$queryRaw<Array<{ next_number: number }>>`
    SELECT "next_number" FROM "order_week_counter" WHERE "week_code" = ${key} LIMIT 1
  `;
  const sequence = Number(rows[0]?.next_number ?? 0) + 1;
  return formatAllocation(workCountry, wc, sequence);
}
