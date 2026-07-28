/**
 * עזרי תצוגה לבקרת קופה – דמי משלוח.
 * קיבוצים / סינון drill נגזרים מאותן שורות SSOT — בלי חישוב KPI נפרד.
 */
import type { ShipmentCashControlRow } from "@/app/admin/shipments/cash-control/types";
import { computeShipmentCashKpis } from "@/app/admin/shipments/cash-control/ssot";

export type CashKpiDrillKey =
  | "fees"
  | "collected"
  | "expenses"
  | "remaining"
  | "shipments"
  | "packages"
  | "rate";

export const CASH_KPI_DRILL_TITLES: Record<CashKpiDrillKey, string> = {
  fees: "דמי משלוח — משלוחים שנכללו",
  collected: "נקלט — משלוחים עם קליטה",
  expenses: "הוצאות יומיות",
  remaining: "יתרה פתוחה",
  shipments: "כל המשלוחים בתקופה",
  packages: "פירוט חבילות",
  rate: "אחוז גבייה — משלוחים שנכללו",
};

export type GroupSummaryRow = {
  key: string;
  label: string;
  shipmentCount: number;
  packagesCount: number;
  totalFeeIls: number;
  collectedIls: number;
  remainingIls: number;
};

export type RowTone = "paid" | "partial" | "unpaid" | "none";

export function rowPaymentTone(row: ShipmentCashControlRow): RowTone {
  if (row.deliveryFeeIls <= 0.001) return "none";
  if (row.remainingFeeIls <= 0.001 && row.paidAmountIls > 0) return "paid";
  if (row.paidAmountIls > 0.001) return "partial";
  return "unpaid";
}

export function filterRowsForKpiDrill(
  rows: readonly ShipmentCashControlRow[],
  key: CashKpiDrillKey,
): ShipmentCashControlRow[] {
  switch (key) {
    case "fees":
    case "shipments":
    case "packages":
    case "rate":
      return [...rows];
    case "collected":
      return rows.filter((r) => r.paidAmountIls > 0.001);
    case "remaining":
      return rows.filter((r) => r.remainingFeeIls > 0.001);
    case "expenses":
      return [];
    default:
      return [...rows];
  }
}

/** מעבר יחיד — O(n) — לקיבוץ לפי שליח / אזור */
export function buildGroupSummaries(
  rows: readonly ShipmentCashControlRow[],
  by: "courier" | "zone",
): GroupSummaryRow[] {
  const map = new Map<string, GroupSummaryRow>();
  for (const r of rows) {
    const key =
      by === "courier"
        ? r.courierId || "__none__"
        : r.zoneId || "__none__";
    const label =
      by === "courier"
        ? r.courierName || "ללא שליח"
        : r.zoneName || "ללא אזור";
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        label,
        shipmentCount: 0,
        packagesCount: 0,
        totalFeeIls: 0,
        collectedIls: 0,
        remainingIls: 0,
      };
      map.set(key, g);
    }
    g.shipmentCount += 1;
    g.packagesCount += r.boxes ?? 0;
    g.totalFeeIls += r.deliveryFeeIls;
    g.collectedIls += r.paidAmountIls;
    g.remainingIls += r.remainingFeeIls;
  }
  return [...map.values()].sort((a, b) => b.remainingIls - a.remainingIls || a.label.localeCompare(b.label, "he"));
}

export function summarizeDrill(
  rows: readonly ShipmentCashControlRow[],
  expensesIls: number,
) {
  return computeShipmentCashKpis(rows, expensesIls);
}
