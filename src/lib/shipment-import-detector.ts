import {
  SHIPMENT_BATCH_DICTIONARY,
  SHIPMENT_COLUMN_DICTIONARY,
  SHIPMENT_FIELD_LABELS,
  type DictionaryEntry,
  type ShipmentBatchField,
  type ShipmentColumnField,
} from "@/lib/shipment-import-dictionary";

export type ShipmentCurrency = "ILS" | "USD" | "EUR" | "TRY" | "GBP" | "UNKNOWN";

export type ParsedMoney = {
  amount: number | null;
  currency: ShipmentCurrency | null;
  raw: string | null;
};

export type ShipmentImportRow = {
  rowIndex: number;
  customerCode: string | null;
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  city: string | null;
  cartonDetails: string | null;
  boxes: number | null;
  weight: number | null;
  orderAmount: number | null;
  orderCurrency: ShipmentCurrency | null;
  orderAmountRaw: string | null;
  notes: string | null;
  valid: boolean;
  error: string | null;
};

export type ShipmentBatchMetadata = {
  sourceShipmentNumber: string | null;
  containerNumber: string | null;
  shippingDate: string | null;
  arrivalDate: string | null;
  releaseDate: string | null;
  warehouseReceiptDate: string | null;
  distributionStartDate: string | null;
  totalWeight: number | null;
  totalBoxes: number | null;
};

export type ShipmentColumnMapping = {
  field: ShipmentColumnField;
  labelHe: string;
  columnIndex: number;
  sourceHeader: string;
  matchedAlias: string;
};

export type ShipmentImportDiagnostic = {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
};

export type ShipmentSheetInput = {
  name: string;
  grid: unknown[][];
};

export type ShipmentImportAnalysis = {
  selectedSheet: string;
  headerRowIndex: number | null;
  dataStartRowIndex: number | null;
  columnMappings: ShipmentColumnMapping[];
  missingFields: { field: ShipmentColumnField; labelHe: string; message: string }[];
  batchMetadata: ShipmentBatchMetadata;
  rows: ShipmentImportRow[];
  diagnostics: ShipmentImportDiagnostic[];
  confidenceScore: number;
};

type HeaderCandidate = {
  rowIndex: number;
  mappings: ShipmentColumnMapping[];
  score: number;
  dataLikeRows: number;
};

const EMPTY_BATCH_METADATA: ShipmentBatchMetadata = {
  sourceShipmentNumber: null,
  containerNumber: null,
  shippingDate: null,
  arrivalDate: null,
  releaseDate: null,
  warehouseReceiptDate: null,
  distributionStartDate: null,
  totalWeight: null,
  totalBoxes: null,
};

const IDENTITY_FIELDS = new Set<ShipmentColumnField>([
  "customerCode",
  "customerName",
  "customerPhone",
  "address",
]);

export function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[_/\\|:;()[\]{}.,'"`´’‘“”\-–—]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function asText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).replace(/\r\n/g, "\n").trim();
  return text || null;
}

function matchDictionary<T extends string>(
  value: unknown,
  dictionary: readonly DictionaryEntry<T>[],
): { field: T; alias: string; quality: number } | null {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;

  let best: { field: T; alias: string; quality: number } | null = null;
  for (const entry of dictionary) {
    for (const alias of entry.aliases) {
      const normalizedAlias = normalizeHeader(alias);
      let quality = 0;
      if (normalized === normalizedAlias) {
        quality = 100;
      } else if (
        normalizedAlias.length >= 4 &&
        (normalized.startsWith(`${normalizedAlias} `) ||
          normalized.endsWith(` ${normalizedAlias}`) ||
          normalized.includes(` ${normalizedAlias} `))
      ) {
        quality = 82;
      }
      if (quality && (!best || quality > best.quality)) {
        best = { field: entry.field, alias, quality };
      }
    }
  }
  return best;
}

function nonEmptyCount(row: unknown[]): number {
  return row.filter((cell) => asText(cell) != null).length;
}

function looksLikeDataRow(row: unknown[], mappings: ShipmentColumnMapping[]): boolean {
  if (!row || nonEmptyCount(row) === 0) return false;
  const mappedValues = mappings.filter((mapping) => asText(row[mapping.columnIndex])).length;
  const hasIdentity = mappings.some(
    (mapping) => IDENTITY_FIELDS.has(mapping.field) && asText(row[mapping.columnIndex]),
  );
  return hasIdentity && mappedValues >= Math.min(2, mappings.length);
}

function mapHeaderRow(row: unknown[]): ShipmentColumnMapping[] {
  const candidates: Array<ShipmentColumnMapping & { quality: number }> = [];
  row.forEach((cell, columnIndex) => {
    const match = matchDictionary(cell, SHIPMENT_COLUMN_DICTIONARY);
    if (!match) return;
    candidates.push({
      field: match.field,
      labelHe: SHIPMENT_FIELD_LABELS[match.field],
      columnIndex,
      sourceHeader: asText(cell) ?? "",
      matchedAlias: match.alias,
      quality: match.quality,
    });
  });

  const byField = new Map<ShipmentColumnField, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    const previous = byField.get(candidate.field);
    if (!previous || candidate.quality > previous.quality) byField.set(candidate.field, candidate);
  }
  return Array.from(byField.values()).map(({ quality: _quality, ...mapping }) => mapping);
}

function detectHeader(grid: unknown[][], scanLimit = 15): HeaderCandidate | null {
  const candidates: HeaderCandidate[] = [];
  const max = Math.min(scanLimit, grid.length);

  for (let rowIndex = 0; rowIndex < max; rowIndex += 1) {
    const row = grid[rowIndex] ?? [];
    const mappings = mapHeaderRow(row);
    const identityMatches = mappings.filter((mapping) => IDENTITY_FIELDS.has(mapping.field)).length;
    if (mappings.length < 2 || identityMatches === 0) continue;

    const dataLikeRows = grid
      .slice(rowIndex + 1, rowIndex + 4)
      .filter((nextRow) => looksLikeDataRow(nextRow ?? [], mappings)).length;
    const populated = nonEmptyCount(row);
    const textCells = row.filter((cell) => {
      const value = asText(cell);
      return value && Number.isNaN(Number(value.replace(/,/g, "")));
    }).length;
    const textRatio = populated ? textCells / populated : 0;
    const score =
      mappings.length * 25 +
      identityMatches * 15 +
      dataLikeRows * 12 +
      Math.round(textRatio * 8);

    candidates.push({ rowIndex, mappings, score, dataLikeRows });
  }

  return candidates.sort((a, b) => b.score - a.score || b.dataLikeRows - a.dataLikeRows)[0] ?? null;
}

function normalizeNumberString(value: string): string {
  const compact = value.replace(/\s/g, "").replace(/[^\d,.\-+]/g, "");
  const lastComma = compact.lastIndexOf(",");
  const lastDot = compact.lastIndexOf(".");

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    return compact.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  }

  const separator = lastComma >= 0 ? "," : lastDot >= 0 ? "." : null;
  if (!separator) return compact;

  const parts = compact.split(separator);
  if (parts.length > 2) return parts.join("");
  const fractionLength = parts[1]?.length ?? 0;
  if (fractionLength === 3 && parts[0].length >= 1) return parts.join("");
  return compact.replace(separator, ".");
}

export function parseFlexibleNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = asText(value);
  if (!text) return null;
  const normalized = normalizeNumberString(text);
  if (!normalized || normalized === "-" || normalized === "+") return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function parseMoney(value: unknown): ParsedMoney {
  const raw = asText(value);
  if (!raw) return { amount: null, currency: null, raw: null };

  const normalized = raw.toLocaleUpperCase();
  let currency: ShipmentCurrency = "UNKNOWN";
  if (/₪|\bILS\b|\bNIS\b/.test(normalized)) currency = "ILS";
  else if (/\$|\bUSD\b/.test(normalized)) currency = "USD";
  else if (/€|\bEUR\b/.test(normalized)) currency = "EUR";
  else if (/₺|\bTRY\b|\bTL\b/.test(normalized)) currency = "TRY";
  else if (/£|\bGBP\b/.test(normalized)) currency = "GBP";

  return { amount: parseFlexibleNumber(raw), currency, raw };
}

function parseDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = asText(value);
  if (!text) return null;

  const dmy = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      parsed.getUTCFullYear() === Number(year) &&
      parsed.getUTCMonth() === Number(month) - 1 &&
      parsed.getUTCDate() === Number(day)
    ) {
      return parsed.toISOString().slice(0, 10);
    }
    return null;
  }

  const ymd = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (ymd) {
    const [, year, month, day] = ymd;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  return null;
}

function detectBatchMetadata(
  grid: unknown[][],
  headerRowIndex: number,
  diagnostics: ShipmentImportDiagnostic[],
): ShipmentBatchMetadata {
  const result: ShipmentBatchMetadata = { ...EMPTY_BATCH_METADATA };
  const rows = grid.slice(0, headerRowIndex);

  rows.forEach((row, rowIndex) => {
    const batchLabelsInRow = row.filter(
      (cell) => matchDictionary(cell, SHIPMENT_BATCH_DICTIONARY) != null,
    ).length;
    row.forEach((cell, columnIndex) => {
      const match = matchDictionary(cell, SHIPMENT_BATCH_DICTIONARY);
      if (!match || result[match.field] != null) return;

      let value: unknown;
      // Multiple labels in one row normally describe a horizontal metadata
      // header whose values are directly below each label.
      if (batchLabelsInRow >= 2) {
        for (let offset = 1; offset <= 2; offset += 1) {
          const nextRow = rows[rowIndex + offset];
          if (nextRow && asText(nextRow[columnIndex])) {
            value = nextRow[columnIndex];
            break;
          }
        }
      }
      // Key/value layouts place the value in the adjacent cell.
      if (!asText(value)) value = row[columnIndex + 1];
      if (!asText(value)) {
        for (let offset = 1; offset <= 2; offset += 1) {
          const nextRow = rows[rowIndex + offset];
          if (nextRow && asText(nextRow[columnIndex])) {
            value = nextRow[columnIndex];
            break;
          }
        }
      }
      if (!asText(value)) return;

      if (match.field === "totalBoxes") {
        result.totalBoxes = parseFlexibleNumber(value);
      } else if (match.field === "totalWeight") {
        result.totalWeight = parseFlexibleNumber(value);
      } else if (
        match.field === "shippingDate" ||
        match.field === "arrivalDate" ||
        match.field === "releaseDate" ||
        match.field === "warehouseReceiptDate" ||
        match.field === "distributionStartDate"
      ) {
        const date = parseDate(value);
        result[match.field] = date;
        if (!date) {
          diagnostics.push({
            level: "warning",
            code: "INVALID_BATCH_DATE",
            message: `הערך "${asText(value)}" עבור ${match.field} זוהה אך אינו תאריך תקין.`,
          });
        }
      } else {
        result[match.field] = asText(value);
      }
    });
  });

  return result;
}

function parseRows(
  grid: unknown[][],
  header: HeaderCandidate,
): ShipmentImportRow[] {
  const byField = new Map(header.mappings.map((mapping) => [mapping.field, mapping.columnIndex]));
  const value = (row: unknown[], field: ShipmentColumnField) => {
    const columnIndex = byField.get(field);
    return columnIndex == null ? undefined : row[columnIndex];
  };

  const parsed: ShipmentImportRow[] = [];
  for (let index = header.rowIndex + 1; index < grid.length; index += 1) {
    const row = grid[index] ?? [];
    if (nonEmptyCount(row) === 0) continue;
    if (mapHeaderRow(row).length >= Math.max(2, header.mappings.length - 1)) continue;

    const customerCode = asText(value(row, "customerCode"));
    const customerName = asText(value(row, "customerName"));
    const customerPhone = asText(value(row, "customerPhone"));
    const address = asText(value(row, "address"));
    const city = asText(value(row, "city"));
    const cartonDetails = asText(value(row, "cartonDetails"));
    const boxesValue = parseFlexibleNumber(value(row, "boxes"));
    const weight = parseFlexibleNumber(value(row, "weight"));
    const money = parseMoney(value(row, "orderAmount"));
    const notes = asText(value(row, "notes"));
    const hasIdentity = Boolean(customerCode || customerName || customerPhone || address);

    parsed.push({
      rowIndex: index + 1,
      customerCode,
      customerName,
      customerPhone,
      address,
      city,
      cartonDetails,
      boxes: boxesValue == null ? null : Math.trunc(boxesValue),
      weight,
      orderAmount: money.amount,
      orderCurrency: money.currency,
      orderAmountRaw: money.raw,
      notes,
      valid: hasIdentity,
      error: hasIdentity ? null : "לא נמצאו בשורה פרטי זיהוי של לקוח, טלפון או כתובת.",
    });
  }
  return parsed;
}

function analyzeSheet(sheet: ShipmentSheetInput): ShipmentImportAnalysis {
  const diagnostics: ShipmentImportDiagnostic[] = [];
  const header = detectHeader(sheet.grid);

  if (!header) {
    return {
      selectedSheet: sheet.name,
      headerRowIndex: null,
      dataStartRowIndex: null,
      columnMappings: [],
      missingFields: SHIPMENT_COLUMN_DICTIONARY.map((entry) => ({
        field: entry.field,
        labelHe: entry.labelHe,
        message: `העמודה '${entry.labelHe}' לא זוהתה בקובץ ולכן לא תמולא.`,
      })),
      batchMetadata: { ...EMPTY_BATCH_METADATA },
      rows: [],
      diagnostics: [{
        level: "error",
        code: "TABLE_HEADER_NOT_FOUND",
        message: "לא נמצאה שורת כותרת אמינה לטבלת המשלוחים ב-15 השורות הראשונות.",
      }],
      confidenceScore: 0,
    };
  }

  const foundFields = new Set(header.mappings.map((mapping) => mapping.field));
  const missingFields = SHIPMENT_COLUMN_DICTIONARY
    .filter((entry) => !foundFields.has(entry.field))
    .map((entry) => ({
      field: entry.field,
      labelHe: entry.labelHe,
      message: `העמודה '${entry.labelHe}' לא קיימת או לא זוהתה בקובץ ולכן לא תמולא.`,
    }));
  const rows = parseRows(sheet.grid, header);
  const batchMetadata = detectBatchMetadata(sheet.grid, header.rowIndex, diagnostics);

  diagnostics.unshift({
    level: "info",
    code: "TABLE_HEADER_DETECTED",
    message: `שורת הכותרת זוהתה בשורה ${header.rowIndex + 1}; הנתונים מתחילים בשורה ${header.rowIndex + 2}.`,
  });
  diagnostics.push({
    level: "info",
    code: "COLUMNS_DETECTED",
    message: `זוהו ${header.mappings.length} עמודות מתוך ${SHIPMENT_COLUMN_DICTIONARY.length}.`,
  });
  if (!foundFields.has("city") && foundFields.has("address")) {
    diagnostics.push({
      level: "warning",
      code: "CITY_FALLBACK_TO_ADDRESS",
      message: "עמודת 'עיר' לא זוהתה. הכתובת תישמר במלואה והשורה לא תיפסל.",
    });
  }

  return {
    selectedSheet: sheet.name,
    headerRowIndex: header.rowIndex,
    dataStartRowIndex: header.rowIndex + 1,
    columnMappings: header.mappings,
    missingFields,
    batchMetadata,
    rows,
    diagnostics,
    confidenceScore: header.score + rows.filter((row) => row.valid).length,
  };
}

export function analyzeShipmentWorkbook(sheets: ShipmentSheetInput[]): ShipmentImportAnalysis {
  if (sheets.length === 0) {
    return analyzeSheet({ name: "", grid: [] });
  }

  const analyses = sheets.map(analyzeSheet).sort((a, b) => b.confidenceScore - a.confidenceScore);
  const selected = analyses[0];
  if (sheets.length > 1) {
    selected.diagnostics.unshift({
      level: "info",
      code: "SHEET_SELECTED",
      message: `הגיליון '${selected.selectedSheet}' נבחר אוטומטית מתוך ${sheets.length} גיליונות לפי התאמת המבנה.`,
    });
  }
  return selected;
}
