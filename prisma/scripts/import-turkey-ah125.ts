/**
 * ייבוא נתוני Turkey אמיתיים (AH-125) למבנה הקיים — Customer + Order בלבד.
 *
 * חוקים (לפי דרישת המשתמש):
 *   - אין Demo אקראי, אין לקוחות/הזמנות פיקטיביים.
 *   - אין יצירת Payment / Receipt / Collection.
 *   - אין טבלאות חדשות — שימוש בטבלאות הקיימות Customer ו-Order.
 *   - לקוח שלא קיים (לפי customerCode) — נוצר; קיים — לא נוצר כפול.
 *   - אידמפוטנטי: הזמנה עם אותו externalId לא תיווצר פעמיים (אפשר להריץ שוב
 *     אחרי הוספת חלקים נוספים — רק החדשות ייכנסו).
 *
 * הרצה:
 *   npx tsx prisma/scripts/import-turkey-ah125.ts
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaClient, Prisma } from "@prisma/client";
import { turkeyOrders, type TurkeyOrderRecord } from "../seeds/turkey-ah125";

const prisma = new PrismaClient();

function dec(n: number): Prisma.Decimal {
  return new Prisma.Decimal(Math.round(n * 10000) / 10000);
}

function parseLocalDate(s: string): Date | null {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** הבטחת שדות המקור החיצוני על טבלת Order — בטוח ואידמפוטנטי. */
async function ensureColumns() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "externalOrderId" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "branch" TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "collector" TEXT`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Order_externalOrderId_idx" ON "Order" ("externalOrderId")`);
}

async function main() {
  const records: TurkeyOrderRecord[] = turkeyOrders;
  console.log(`[import-turkey] רשומות במקור הנתונים: ${records.length}`);
  if (records.length === 0) {
    console.log("[import-turkey] אין נתונים לייבוא.");
    return;
  }

  await ensureColumns();

  const week = records[0]?.week ?? "AH-125";
  const weekNum = week.replace(/\D/g, "") || "0";
  const prefix = `TR-${weekNum}-`;

  // הזמנות קיימות שכבר יובאו (dedupe לפי externalOrderId)
  const externalIds = records.map((r) => String(r.externalId));
  const existing = await prisma.order.findMany({
    where: { externalOrderId: { in: externalIds } },
    select: { externalOrderId: true },
  });
  const alreadyImported = new Set(existing.map((o) => o.externalOrderId));

  // מספור הזמנות מערכתי רציף (TR-<week>-####) שאינו מתנגש בקיים
  const existingNums = await prisma.order.findMany({
    where: { orderNumber: { startsWith: prefix } },
    select: { orderNumber: true },
  });
  let seq = existingNums.reduce((mx, o) => {
    const n = Number((o.orderNumber ?? "").slice(prefix.length));
    return Number.isFinite(n) && n > mx ? n : mx;
  }, 0);

  const customerIdByCode = new Map<string, string>();
  const seenInRun = new Set<string>(); // מניעת כפילות externalId בתוך אותו מערך/ריצה
  let createdOrders = 0;
  let skippedExisting = 0;
  let createdCustomers = 0;
  const customerCodesSeen = new Set<string>();

  for (const rec of records) {
    const extId = String(rec.externalId);
    if (alreadyImported.has(extId) || seenInRun.has(extId)) {
      skippedExisting += 1;
      continue;
    }
    seenInRun.add(extId);
    const code = rec.customerCode.trim();
    if (!code) {
      console.warn(`[import-turkey] דילוג: externalId=${extId} ללא קוד לקוח`);
      continue;
    }

    // לקוח — יצירה רק אם לא קיים (לפי customerCode הייחודי)
    let customerId = customerIdByCode.get(code);
    if (!customerId) {
      const found = await prisma.customer.findUnique({
        where: { customerCode: code },
        select: { id: true },
      });
      if (found) {
        customerId = found.id;
      } else {
        const created = await prisma.customer.create({
          data: {
            customerCode: code,
            displayName: rec.customerName || code,
            nameEn: rec.customerName || null,
            country: rec.country || "TURKEY",
            countryCode: "TR",
          },
          select: { id: true },
        });
        customerId = created.id;
        createdCustomers += 1;
      }
      customerIdByCode.set(code, customerId);
    }
    customerCodesSeen.add(code);

    seq += 1;
    const orderNumber = `${prefix}${String(seq).padStart(4, "0")}`;
    const orderDate = parseLocalDate(rec.collectionDate);

    await prisma.order.create({
      data: {
        orderNumber,
        oldOrderNumber: extId,
        externalOrderId: extId,
        customerId,
        customerCodeSnapshot: code,
        customerNameSnapshot: rec.customerName || code,
        weekCode: rec.week,
        countryCode: "TR",
        orderDate: orderDate ?? undefined,
        amountUsd: dec(rec.amount),
        totalUsd: dec(rec.amount),
        paymentMethod: rec.paymentMethod || null,
        branch: rec.branch || null,
        collector: rec.collector || null,
        status: "OPEN",
        isActive: true,
      },
    });
    createdOrders += 1;
  }

  console.log("\n========== סיכום ייבוא Turkey (AH-125) ==========");
  console.log(`שבוע: ${week}  |  מספור מערכתי: ${prefix}####`);
  console.log(`לקוחות ייחודיים שנגעו בהם: ${customerCodesSeen.size}`);
  console.log(`לקוחות חדשים שנוצרו: ${createdCustomers}`);
  console.log(`הזמנות חדשות שנוצרו: ${createdOrders}`);
  console.log(`הזמנות שדולגו (כבר קיימות): ${skippedExisting}`);
  console.log("=================================================");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
