import * as XLSX from "xlsx";

export type ReconResultStatus =
  | "MATCHED"
  | "AMOUNT_DIFF"
  | "MISSING_IN_SYSTEM"
  | "MISSING_IN_EXTERNAL";

export type ExternalReconRow = {
  customerCode: string | null;
  orderNumber: string | null;
  amount: number | null;
  dateIso: string | null;
};

export type SystemOrderForRecon = {
  orderNumber: string | null;
  customerCode: string | null;
  customerName: string | null;
  amount: number | null;
  dateIso: string | null;
};

export type ReconResultRow = {
  customerName: string | null;
  systemCustomerCode: string | null;
  externalCustomerCode: string | null;
  systemOrderNumber: string | null;
  externalOrderNumber: string | null;
  systemAmount: number | null;
  externalAmount: number | null;
  diff: number | null;
  status: ReconResultStatus;
};

export type ReconKpis = {
  systemTotal: number;
  externalTotal: number;
  matched: number;
  mismatched: number;
  missingSystem: number;
  missingExternal: number;
};

const AMOUNT_EPSILON = 0.01;

type SheetCell = string | number | boolean | Date | null | undefined;

function normalizeHeader(value: SheetCell): string {
  return String(value ?? "")
    // המרת תווים טורקיים לפני lowercase — אחרת "İ" הופך ל-"i" + סימן ניקוד משולב
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

/** מילות מפתח לזיהוי עמודות — עברית / אנגלית / טורקית */
const FIELD_KEYWORDS: Record<keyof ExternalReconRow, string[]> = {
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
  orderNumber: [
    "מספר הזמנה",
    "מס הזמנה",
    "order number",
    "order no",
    "order id",
    "siparis no",
    "siparis",
    "order",
    "הזמנה",
    // עמודת ID של קובץ טורקיה (מספר הזמנה). נשמר אחרון כדי שלא יתפוס "musteri id" / "customer id".
    "id",
  ],
  amount: ["סכום", "סה\"כ", "amount", "total", "toplam", "sum", "tutar", "usd", "price"],
  dateIso: ["תאריך", "date", "tarih", "tahsilat tarihi"],
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
    // המפריד האחרון הוא העשרוני
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
  // dd.mm.yyyy / dd/mm/yyyy
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

type ColumnMap = Partial<Record<keyof ExternalReconRow, number>>;

function detectColumns(header: SheetCell[]): ColumnMap {
  const map: ColumnMap = {};
  const norm = header.map(normalizeHeader);
  (Object.keys(FIELD_KEYWORDS) as (keyof ExternalReconRow)[]).forEach((field) => {
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

/** פענוח קובץ Excel/CSV לשורות חיצוניות — ללא שמירה במסד. */
export function parseExternalReconFile(buffer: Buffer): ExternalReconRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<SheetCell[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  if (!rows.length) return [];

  const headerIdx = findHeaderRow(rows);
  const col = detectColumns(rows[headerIdx] ?? []);
  const dataRows = rows.slice(headerIdx + 1).filter((r) => !isRowEmpty(r));

  const out: ExternalReconRow[] = [];
  for (const row of dataRows) {
    const cell = (field: keyof ExternalReconRow): SheetCell =>
      col[field] == null ? undefined : row[col[field] as number];
    const customerCode = String(cell("customerCode") ?? "").trim() || null;
    const orderNumber = String(cell("orderNumber") ?? "").trim() || null;
    const amount = parseAmount(cell("amount"));
    const dateIso = parseDate(cell("dateIso"));
    // שורה חייבת לזהות הזמנה (קוד לקוח או מספר הזמנה). שורות עם סכום בלבד (סיכום/ריקות) מסוננות.
    if (!customerCode && !orderNumber) continue;
    out.push({ customerCode, orderNumber, amount, dateIso });
  }
  return out;
}

function normKey(v: string | null): string {
  return (v ?? "").trim().toLowerCase();
}

function sameDay(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a.slice(0, 10) === b.slice(0, 10);
}

/**
 * התאמה בין הזמנות המערכת לשורות הקובץ החיצוני.
 *
 * מפתח ההתאמה הוא **קוד לקוח + סכום** (לא מספר הזמנה — מספרי ההזמנה בקובץ
 * החיצוני שונים מאלה שבמערכת). תאריך משמש כשובר-שוויון כשיש כמה מועמדים
 * לאותו לקוח עם אותו סכום.
 */
export function reconcile(
  systemOrders: SystemOrderForRecon[],
  externalRows: ExternalReconRow[],
): { rows: ReconResultRow[]; kpis: ReconKpis } {
  const byCustomer = new Map<string, SystemOrderForRecon[]>();
  for (const o of systemOrders) {
    const k = normKey(o.customerCode);
    if (!k) continue;
    const arr = byCustomer.get(k) ?? [];
    arr.push(o);
    byCustomer.set(k, arr);
  }

  const usedSystem = new Set<SystemOrderForRecon>();
  const rows: ReconResultRow[] = [];
  let matched = 0;
  let mismatched = 0;
  let missingSystem = 0;

  const amountMatches = (sys: SystemOrderForRecon, ext: ExternalReconRow): boolean =>
    sys.amount != null && ext.amount != null && Math.abs(sys.amount - ext.amount) <= AMOUNT_EPSILON;

  for (const ext of externalRows) {
    const key = normKey(ext.customerCode);
    const candidates = key ? (byCustomer.get(key) ?? []).filter((c) => !usedSystem.has(c)) : [];

    // אין הזמנה במערכת לאותו קוד לקוח -> חסר במערכת
    if (candidates.length === 0) {
      missingSystem += 1;
      rows.push({
        customerName: null,
        systemCustomerCode: null,
        externalCustomerCode: ext.customerCode,
        systemOrderNumber: null,
        externalOrderNumber: ext.orderNumber,
        systemAmount: null,
        externalAmount: ext.amount,
        diff: null,
        status: "MISSING_IN_SYSTEM",
      });
      continue;
    }

    // עדיפות: סכום תואם (ובתוכם — אותו תאריך). אחרת המועמד עם הסכום הקרוב ביותר.
    const exact = candidates.filter((c) => amountMatches(c, ext));
    let chosen: SystemOrderForRecon;
    let isMatch: boolean;
    if (exact.length > 0) {
      chosen = exact.find((c) => sameDay(c.dateIso, ext.dateIso)) ?? exact[0];
      isMatch = true;
    } else {
      chosen = [...candidates].sort(
        (a, b) =>
          Math.abs((a.amount ?? Number.POSITIVE_INFINITY) - (ext.amount ?? 0)) -
          Math.abs((b.amount ?? Number.POSITIVE_INFINITY) - (ext.amount ?? 0)),
      )[0];
      isMatch = false;
    }

    usedSystem.add(chosen);
    const diff =
      chosen.amount != null && ext.amount != null
        ? Math.round((chosen.amount - ext.amount) * 100) / 100
        : null;
    if (isMatch) matched += 1;
    else mismatched += 1;
    rows.push({
      customerName: chosen.customerName,
      systemCustomerCode: chosen.customerCode,
      externalCustomerCode: ext.customerCode,
      systemOrderNumber: chosen.orderNumber,
      externalOrderNumber: ext.orderNumber,
      systemAmount: chosen.amount,
      externalAmount: ext.amount,
      diff,
      status: isMatch ? "MATCHED" : "AMOUNT_DIFF",
    });
  }

  let missingExternal = 0;
  for (const o of systemOrders) {
    if (usedSystem.has(o)) continue;
    missingExternal += 1;
    rows.push({
      customerName: o.customerName,
      systemCustomerCode: o.customerCode,
      externalCustomerCode: null,
      systemOrderNumber: o.orderNumber,
      externalOrderNumber: null,
      systemAmount: o.amount,
      externalAmount: null,
      diff: null,
      status: "MISSING_IN_EXTERNAL",
    });
  }

  return {
    rows,
    kpis: {
      systemTotal: systemOrders.length,
      externalTotal: externalRows.length,
      matched,
      mismatched,
      missingSystem,
      missingExternal,
    },
  };
}
