import type { Prisma, WorkCountryCode as PrismaWorkCountryCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureOnce } from "@/lib/ensure-tables-once";
import { DEFAULT_WEEK_CODE } from "@/lib/work-week";
import {
  DEFAULT_WORK_COUNTRY,
  formatOrderNumber,
  orderCounterKey,
  orderNumberCountryPrefix,
  orderSourceCountryFromWorkCountry,
  weekNumericPart,
  type WorkCountryCode,
} from "@/lib/work-country";

export type OrderNumberAllocation = {
  orderNumber: string;
  oldOrderNumber: string;
  sequence: number;
};

const BOOTSTRAPPED_GLOBAL_KEY = "__wegoOrderCounterBootstrapped__";

function bootstrappedKeys(): Set<string> {
  const g = globalThis as typeof globalThis & { [BOOTSTRAPPED_GLOBAL_KEY]?: Set<string> };
  if (!g[BOOTSTRAPPED_GLOBAL_KEY]) g[BOOTSTRAPPED_GLOBAL_KEY] = new Set();
  return g[BOOTSTRAPPED_GLOBAL_KEY];
}

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
  const display = orderNumberCountryPrefix(workCountry);
  const modern = `${display}-${wn}-`;
  if (workCountry === "TR") {
    return [modern, `AH-${wn}-`, `${weekCode.trim()}-`];
  }
  if (workCountry === "CN") {
    return [modern, `CN-${wn}-`];
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

/** סריקת MAX — findFirst+orderBy במקום aggregate על כל הטבלה */
async function scanMaxSequenceFromOrders(
  workCountry: WorkCountryCode,
  weekCode: string,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<number> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const prefixes = orderNumberPrefixes(workCountry, wc);
  const sourceCountry = orderSourceCountryFromWorkCountry(workCountry);
  const wn = weekNumericPart(wc);
  const orClauses = [
    ...prefixes.map((p) => ({ orderNumber: { startsWith: p } })),
    ...(workCountry === "TR" ? [{ orderNumber: { startsWith: `AH-${wn}-` } }] : []),
  ];

  let maxSeq = 0;
  const latest = await db.order.findFirst({
    where: {
      countryCode: workCountry as PrismaWorkCountryCode,
      sourceCountry,
      weekCode: wc,
      isActive: true,
      OR: orClauses,
    },
    orderBy: { orderNumber: "desc" },
    select: { orderNumber: true },
  });
  if (latest?.orderNumber) {
    maxSeq = Math.max(maxSeq, parseSeqFromOrderNumber(latest.orderNumber, prefixes));
  }

  const oldLatest = await db.order.findFirst({
    where: {
      countryCode: workCountry as PrismaWorkCountryCode,
      sourceCountry,
      weekCode: wc,
      isActive: true,
      oldOrderNumber: { not: null },
    },
    orderBy: { oldOrderNumber: "desc" },
    select: { oldOrderNumber: true },
  });
  const oldMax = oldLatest?.oldOrderNumber?.trim();
  if (oldMax && /^\d{4}$/.test(oldMax)) {
    maxSeq = Math.max(maxSeq, parseInt(oldMax, 10));
  }

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

async function bumpCounter(
  counterKey: string,
  db: Prisma.TransactionClient,
): Promise<number | null> {
  const rows = await db.$queryRaw<Array<{ next_number: number }>>`
    UPDATE "order_week_counter"
    SET "next_number" = "next_number" + 1,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "week_code" = ${counterKey}
    RETURNING "next_number"
  `;
  const sequence = Number(rows[0]?.next_number ?? 0);
  return sequence > 0 ? sequence : null;
}

async function ensureWeekCounterRow(
  workCountry: WorkCountryCode,
  weekCode: string,
  db: Prisma.TransactionClient,
): Promise<void> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const key = orderCounterKey(workCountry, wc);
  if (await counterRowExists(key, db)) return;

  const bootstrapped = bootstrappedKeys();
  const maxSeq = bootstrapped.has(key) ? 0 : await scanMaxSequenceFromOrders(workCountry, wc, db);
  bootstrapped.add(key);

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

/** הקצאה אטומית — מונה לפי מדינה+שבוע; UPDATE בפעולה אחת כשהשורה קיימת */
export async function allocateNextOrderNumberFromCounter(
  weekCode: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<OrderNumberAllocation> {
  const wc = weekCode.trim() || DEFAULT_WEEK_CODE;
  const key = orderCounterKey(workCountry, wc);
  await ensureOrderWeekCounterTable();

  return prisma.$transaction(async (tx) => {
    let sequence = await bumpCounter(key, tx);
    if (sequence != null) return formatAllocation(workCountry, wc, sequence);

    await ensureWeekCounterRow(workCountry, wc, tx);
    sequence = await bumpCounter(key, tx);
    if (sequence == null) {
      throw new Error("order counter allocation failed");
    }
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

  const rows = await prisma.$queryRaw<Array<{ next_number: number }>>`
    SELECT "next_number" FROM "order_week_counter" WHERE "week_code" = ${key} LIMIT 1
  `;
  if (rows.length > 0) {
    const sequence = Number(rows[0]?.next_number ?? 0) + 1;
    return formatAllocation(workCountry, wc, sequence);
  }

  await prisma.$transaction(async (tx) => {
    await ensureWeekCounterRow(workCountry, wc, tx);
  });

  const after = await prisma.$queryRaw<Array<{ next_number: number }>>`
    SELECT "next_number" FROM "order_week_counter" WHERE "week_code" = ${key} LIMIT 1
  `;
  const sequence = Number(after[0]?.next_number ?? 0) + 1;
  return formatAllocation(workCountry, wc, sequence);
}

/** חימום מונה לשבוע+מדינה — לקריאה מ-/api/orders/next-number או בפתיחת טופס */
export async function warmOrderWeekCounter(
  weekCode: string,
  workCountry: WorkCountryCode = DEFAULT_WORK_COUNTRY,
): Promise<void> {
  await peekNextOrderNumberFromCounter(weekCode, workCountry);
}
