import * as XLSX from "xlsx";
import type { ExternalReconRow } from "./reconcile-core";

export type {
  ExternalReconRow,
  SystemOrderForRecon,
  ReconResultRow,
  ReconKpis,
  ReconSeverity,
} from "./reconcile-core";
export { reconcile, classifyDiff, RECON_THRESHOLDS } from "./reconcile-core";

type SheetCell = string | number | boolean | Date | null | undefined;

function normalizeHeader(value: SheetCell): string {
  return String(value ?? "")
    // המרת תווים טורקיים לפני lowercase
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
    .replace(/["'.,()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type ParsedField = "customerCode" | "externalId" | "customerName" | "amount" | "dateIso" | "week";

/** מילות מפתח לזיהוי עמודות — עברית / אנגלית / טורקית */
const FIELD_KEYWORDS: Record<ParsedField, string[]> = {
  customerCode: [
    "קוד לקוח",
    "מספר לקוח",
    "customer code",
    "customer id",
    "musteri id",
    "musteri kodu",
    "client code",
    "code",
    "קוד",
  ],
  customerName: [
    "שם לקוח",
    "customer name",
    "musteri adi",
    "client name",
    "name",
    "שם",
  ],
  externalId: [
    "external id",
    "מספר הזמנה",
    "מס הזמנה",
    "order number",
    "order no",
    "order id",
    "siparis no",
    "siparis",
    "order",
    "הזמנה",
    // עמודת ID של קובץ טורקיה (מספר הזמנה). אחרון כדי שלא יתפוס "musteri id" / "customer id".
    "id",
  ],
  amount: ["סכום", "סה\"כ", "amount", "total", "toplam", "sum", "tutar", "usd", "price"],
  dateIso: ["תאריך", "date", "tarih", "tahsilat tarihi"],
  week: ["שבוע", "week", "aciklama", "açıklama", "hafta"],
};

function parseAmount(value: SheetCell): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let raw = String(value)
    .replace(/[$₪€£\s]/g, "")
    .replace(/[a-zא-ת]/gi, "")
    .trim();
  if (!raw) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  if (hasComma && hasDot) {
    if (raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      raw = raw.replace(/\./g, "").replace(",", ".");
    } else {
      raw = raw.replace(/,/g, "");
    }
  } else if (hasComma) {
    raw = raw.replace(",", ".");
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: SheetCell): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const s = String(value ?? "").trim();
  if (!s) return null;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(s);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += 2000;
    const dt = new Date(y, mo - 1, d);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** זיהוי קוד שבוע (AH-###) מתא כלשהו. */
function extractWeekCode(value: SheetCell): string | null {
  const m = /AH[-\s]?(\d{1,4})/i.exec(String(value ?? ""));
  return m ? `AH-${m[1]}` : null;
}

type ColumnMap = Partial<Record<ParsedField, number>>;

function detectColumns(header: SheetCell[]): ColumnMap {
  const map: ColumnMap = {};
  const norm = header.map(normalizeHeader);
  (Object.keys(FIELD_KEYWORDS) as ParsedField[]).forEach((field) => {
    for (const kw of FIELD_KEYWORDS[field]) {
      const idx = norm.findIndex((h) => h && h.includes(kw));
      if (idx >= 0) {
        map[field] = idx;
        break;
      }
    }
  });
  return map;
}

function findHeaderRow(rows: SheetCell[][]): number {
  const scan = Math.min(rows.length, 20);
  for (let i = 0; i < scan; i++) {
    const map = detectColumns(rows[i] ?? []);
    const hits = Object.keys(map).length;
    if (hits >= 2) return i;
  }
  return 0;
}

function isRowEmpty(row: SheetCell[]): boolean {
  return !row.some((c) => String(c ?? "").trim() !== "");
}

export type ParsedReconFile = {
  rows: ExternalReconRow[];
  /** שבוע שזוהה בקובץ (AH-###) — הרוב המוחלט מבין השורות. */
  weekDetected: string | null;
};

/** פענוח קובץ Excel/CSV לשורות חיצוניות — ללא שמירה במסד. */
export function parseExternalReconFileFull(buffer: Buffer): ParsedReconFile {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { rows: [], weekDetected: null };
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (!rows.length) return { rows: [], weekDetected: null };

  const headerIdx = findHeaderRow(rows);
  const col = detectColumns(rows[headerIdx] ?? []);
  const dataRows = rows.slice(headerIdx + 1).filter((r) => !isRowEmpty(r));

  const out: ExternalReconRow[] = [];
  const weekVotes = new Map<string, number>();

  for (const row of dataRows) {
    const cell = (field: ParsedField): SheetCell =>
      col[field] == null ? undefined : row[col[field] as number];
    const customerCode = String(cell("customerCode") ?? "").trim() || null;
    const externalId = String(cell("externalId") ?? "").trim() || null;
    const customerName = String(cell("customerName") ?? "").trim() || null;
    const amount = parseAmount(cell("amount"));
    const dateIso = parseDate(cell("dateIso"));

    // זיהוי שבוע: מעמודת week אם קיימת, אחרת מסריקת כל התא בשורה.
    let wk = extractWeekCode(cell("week"));
    if (!wk) {
      for (const c of row) {
        wk = extractWeekCode(c);
        if (wk) break;
      }
    }
    if (wk) weekVotes.set(wk, (weekVotes.get(wk) ?? 0) + 1);

    // שורה חייבת לזהות הזמנה (קוד לקוח או מזהה חיצוני). שורות סיכום/ריקות מסוננות.
    if (!customerCode && !externalId) continue;
    out.push({ externalId, customerCode, customerName, amount, dateIso });
  }

  let weekDetected: string | null = null;
  let best = 0;
  for (const [wk, n] of weekVotes) {
    if (n > best) {
      best = n;
      weekDetected = wk;
    }
  }

  return { rows: out, weekDetected };
}

/** תאימות לאחור — מחזיר שורות בלבד. */
export function parseExternalReconFile(buffer: Buffer): ExternalReconRow[] {
  return parseExternalReconFileFull(buffer).rows;
}
