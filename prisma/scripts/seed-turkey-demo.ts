/**
 * זריעת הזמנות דמו מתוך קובץ טורקיה (collecting_excel_report) למבנה ההזמנות הקיים.
 *
 * אין מבנה/טבלה/שדות חדשים — שימוש ב-Order + Customer הקיימים בלבד.
 * ההזמנות נשמרות תחת שבוע העבודה מתוך עמודת AÇIKLAMA (ברירת מחדל AH-125),
 * או לפי --week=AH-XXX אם הועבר.
 *
 * לצורך בדיקת מנגנון ההתאמה מוזרקות אי-התאמות מכוונות:
 *   - מספר שורות מדולגות (לא נוצרות) -> ייראו כ"חסר במערכת" בהשוואה.
 *   - מספר שורות עם סכום שונה (+100$) -> ייראו כ"פער סכום".
 *
 * הרצה:
 *   npx tsx prisma/scripts/seed-turkey-demo.ts
 *   npx tsx prisma/scripts/seed-turkey-demo.ts --week=AH-128 "C:\\path\\file.xlsx"
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaClient, Prisma } from "@prisma/client";
import * as XLSX from "xlsx";

const prisma = new PrismaClient();

const SEED_MARKER = "TURKEY-DEMO-SEED";
const DEFAULT_FILE = "C:\\Users\\omer2\\Downloads\\collecting_excel_report (1).xlsx";

type Cell = string | number | boolean | Date | null | undefined;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

function normalizeHeader(v: Cell): string {
  return String(v ?? "")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .replace(/Ş/g, "S")
    .replace(/ş/g, "s")
    .replace(/Ç/g, "C")
    .replace(/ç/g, "c")
    .replace(/Ğ/g, "G")
    .replace(/ğ/g, "g")
    .replace(/Ö/g, "O")
    .replace(/ö/g, "o")
    .replace(/Ü/g, "U")
    .replace(/ü/g, "u")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(v: Cell): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let raw = String(v).replace(/[$₪€£\s]/g, "").trim();
  if (!raw) return null;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) raw = raw.replace(/\./g, "").replace(",", ".");
    else raw = raw.replace(/,/g, "");
  } else if (hasComma) {
    raw = raw.replace(",", ".");
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: Cell): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dec(n: number | null): Prisma.Decimal | null {
  return n == null ? null : new Prisma.Decimal(Math.round(n * 10000) / 10000);
}

async function main() {
  const file = process.argv.find((a) => /\.(xlsx|xls|csv)$/i.test(a)) ?? DEFAULT_FILE;
  const forcedWeek = arg("week") ?? null;

  console.log(`[seed-turkey-demo] file: ${file}`);
  console.log(`[seed-turkey-demo] forced week: ${forcedWeek ?? "(use file AÇIKLAMA)"}`);

  const wb = XLSX.readFile(file, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: false, defval: "" });

  // איתור שורת כותרת
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const norm = (rows[i] ?? []).map(normalizeHeader);
    if (norm.includes("musteri id") && norm.includes("toplam")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("לא נמצאה שורת כותרת (MÜŞTERİ ID / TOPLAM)");

  const header = (rows[headerIdx] ?? []).map(normalizeHeader);
  const col = {
    id: header.findIndex((h) => h === "id"),
    code: header.findIndex((h) => h.includes("musteri id")),
    name: header.findIndex((h) => h.includes("musteri adi")),
    date: header.findIndex((h) => h.includes("tahsilat tarihi")),
    week: header.findIndex((h) => h.includes("aciklama")),
    amount: header.findIndex((h) => h.includes("toplam")),
  };
  console.log("[seed-turkey-demo] columns:", col);

  const rawRows = rows.slice(headerIdx + 1).filter((r) => String(r[col.id] ?? "").trim() !== "");
  console.log(`[seed-turkey-demo] data rows: ${rawRows.length}`);

  type Rec = {
    fileId: string;
    code: string;
    name: string;
    amount: number | null;
    date: Date | null;
    weekCode: string;
  };

  const records: Rec[] = rawRows.map((row) => {
    const fileWeek = col.week >= 0 ? String(row[col.week] ?? "").trim() : "";
    return {
      fileId: String(row[col.id] ?? "").trim(),
      code: String(row[col.code] ?? "").trim(),
      name: String(row[col.name] ?? "").trim(),
      amount: parseAmount(row[col.amount]),
      date: col.date >= 0 ? parseDate(row[col.date]) : null,
      weekCode: forcedWeek ?? (fileWeek || "AH-125"),
    };
  });

  // ניקוי זריעה קודמת — כדי שהמצב יהיה דטרמיניסטי
  const removed = await prisma.order.deleteMany({ where: { notes: SEED_MARKER } });
  console.log(`[seed-turkey-demo] נמחקו הזמנות דמו קודמות: ${removed.count}`);

  // תדירות קוד לקוח — לבחירת שורות "פער"/"חסר" מלקוחות ייחודיים (כדי שההתאמה
  // לפי קוד לקוח + סכום תיתן קטגוריות נקיות).
  const freq = new Map<string, number>();
  for (const r of records) freq.set(r.code, (freq.get(r.code) ?? 0) + 1);
  const uniqueRecs = records.filter((r) => r.code && r.amount != null && freq.get(r.code) === 1);

  // 5 רשומות פער סכום + 5 רשומות חסר במערכת — מתוך לקוחות ייחודיים
  const SMALL_DIFFS = [10, -10, 10, -10, 10];
  const diffSet = new Map<string, number>(); // fileId -> הפרש
  const missSet = new Set<string>(); // fileId שלא ייווצרו
  for (let k = 0; k < 5 && k < uniqueRecs.length; k++) diffSet.set(uniqueRecs[k].fileId, SMALL_DIFFS[k]);
  for (let k = 5; k < 10 && k < uniqueRecs.length; k++) missSet.add(uniqueRecs[k].fileId);

  // מספרי הזמנה מערכתיים ריאליסטיים (TR-<week>-####) — שונים ממספרי הקובץ
  const weekNum = (forcedWeek ?? records[0]?.weekCode ?? "AH-125").replace(/\D/g, "") || "0";
  const prefix = `TR-${weekNum}-`;
  const existingNums = await prisma.order.findMany({
    where: { orderNumber: { startsWith: prefix } },
    select: { orderNumber: true },
  });
  let seq = existingNums.reduce((mx, o) => {
    const n = Number((o.orderNumber ?? "").slice(prefix.length));
    return Number.isFinite(n) && n > mx ? n : mx;
  }, 0);

  const customerIdByCode = new Map<string, string>();
  let created = 0;
  let skipped = 0;
  const identicalIds: string[] = [];
  const diffIds: string[] = [];
  const skippedIds: string[] = [];
  const weeksSeen = new Set<string>();

  for (const rec of records) {
    weeksSeen.add(rec.weekCode);

    // חסר במערכת — לא יוצרים הזמנה
    if (missSet.has(rec.fileId)) {
      skipped += 1;
      skippedIds.push(`${rec.fileId} / ${rec.code}`);
      continue;
    }
    if (!rec.code) {
      skipped += 1;
      continue;
    }

    let seedAmount = rec.amount;
    if (diffSet.has(rec.fileId) && rec.amount != null) {
      seedAmount = rec.amount + (diffSet.get(rec.fileId) as number);
      diffIds.push(`${rec.code} (קובץ ${rec.amount} → מערכת ${seedAmount})`);
    } else {
      identicalIds.push(rec.fileId);
    }

    let customerId = customerIdByCode.get(rec.code);
    if (!customerId) {
      const customer = await prisma.customer.upsert({
        where: { customerCode: rec.code },
        update: { displayName: rec.name || rec.code },
        create: { customerCode: rec.code, displayName: rec.name || rec.code, countryCode: "TR" },
        select: { id: true },
      });
      customerId = customer.id;
      customerIdByCode.set(rec.code, customerId);
    }

    seq += 1;
    const orderNumber = `${prefix}${String(seq).padStart(4, "0")}`;

    await prisma.order.create({
      data: {
        orderNumber,
        customerId,
        customerCodeSnapshot: rec.code,
        customerNameSnapshot: rec.name || rec.code,
        weekCode: rec.weekCode,
        orderDate: rec.date ?? undefined,
        amountUsd: dec(seedAmount),
        totalUsd: dec(seedAmount),
        status: "OPEN",
        countryCode: "TR",
        isActive: true,
        notes: SEED_MARKER,
      },
    });
    created += 1;
  }

  console.log("\n========== סיכום זריעה (QA) ==========");
  console.log(`שבועות: ${[...weeksSeen].join(", ")}`);
  console.log(`מספרי הזמנה מערכתיים: ${prefix}#### (התאמה לפי קוד לקוח + סכום)`);
  console.log(`נוצרו סה"כ: ${created}`);
  console.log(`התאמה מלאה (זהים לקובץ): ${identicalIds.length}`);
  console.log(`פער סכום (אי-התאמה): ${diffIds.join(" | ") || "—"}`);
  console.log(`חסר במערכת (לא נוצרו): ${skippedIds.join(", ") || "—"}`);
  console.log("=====================================");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
