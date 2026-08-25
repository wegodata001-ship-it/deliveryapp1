/**
 * SSOT — סוגי הוצאות משלוח (ShipmentExpenseType).
 * הקוד נשמר בשורות ההוצאה; התווית מגיעה מהטבלה.
 */

export type ShipmentExpenseTypeDto = {
  id: string;
  code: string;
  label: string;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
  usageCount: number;
};

/** זרע ברירת מחדל — תואם למיגרציה; משמש גם כ-fallback לתצוגה */
export const SHIPMENT_EXPENSE_TYPE_SEED: ReadonlyArray<{
  code: string;
  label: string;
  sortOrder: number;
}> = [
  { code: "FUEL", label: "דלק", sortOrder: 10 },
  { code: "ROAD6", label: "כביש 6", sortOrder: 20 },
  { code: "PARKING", label: "חניה", sortOrder: 30 },
  { code: "PORT", label: "נמל", sortOrder: 40 },
  { code: "STORAGE", label: "אחסנה", sortOrder: 50 },
  { code: "UNLOADING", label: "פריקה", sortOrder: 60 },
  { code: "TRANSPORT", label: "הובלה", sortOrder: 70 },
  { code: "CUSTOMER_REFUND", label: "החזר ללקוח", sortOrder: 80 },
  { code: "OTHER", label: "אחר", sortOrder: 90 },
];

const SEED_LABEL_BY_CODE: Record<string, string> = Object.fromEntries(
  SHIPMENT_EXPENSE_TYPE_SEED.map((t) => [t.code, t.label]),
);

export function fallbackShipmentExpenseTypeLabel(code: string): string {
  return SEED_LABEL_BY_CODE[code] ?? code;
}

export function resolveExpenseTypeLabel(
  code: string,
  labelMap?: Map<string, string> | null,
): string {
  return labelMap?.get(code) ?? fallbackShipmentExpenseTypeLabel(code);
}

export function normalizeExpenseTypeLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function generateCustomExpenseTypeCode(): string {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `C_${Date.now().toString(36).toUpperCase()}_${rand}`;
}
