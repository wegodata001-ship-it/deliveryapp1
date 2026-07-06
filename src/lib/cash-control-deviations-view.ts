/**
 * אגרגציית חריגות לתצוגה היררכית (סיכום → הזמנה → אמצעי תשלום).
 */

import type { CashControlDeviationRow } from "@/lib/cash-control-deviations-shared";

export type DeviationSummaryCategoryId =
  | "CASH"
  | "CREDIT"
  | "BANK_TRANSFER"
  | "CHECK"
  | "AMOUNT"
  | "OTHER";

export type DeviationSummaryRow = {
  id: DeviationSummaryCategoryId;
  label: string;
  count: number;
  totalUsd: number;
};

const CATEGORY_META: { id: DeviationSummaryCategoryId; label: string }[] = [
  { id: "CASH", label: "חריגות מזומן" },
  { id: "CREDIT", label: "חריגות אשראי" },
  { id: "BANK_TRANSFER", label: "חריגות העברה בנקאית" },
  { id: "CHECK", label: "חריגות צ׳קים" },
  { id: "AMOUNT", label: "חריגות סכום" },
  { id: "OTHER", label: "חריגות אחרות" },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseDeviationUsd(value: string | null | undefined): number {
  if (!value || value === "—") return 0;
  const n = Number(String(value).replace(/[+$,]/g, ""));
  return Number.isFinite(n) ? round2(Math.abs(n)) : 0;
}

export function rowSummaryCategory(row: CashControlDeviationRow): DeviationSummaryCategoryId {
  if (row.deviationType === "amount") return "AMOUNT";
  if (row.deviationType === "method") {
    const label = row.methodLabel ?? "";
    if (label.includes("מזומן")) return "CASH";
    if (label.includes("אשראי")) return "CREDIT";
    if (label.includes("העברה")) return "BANK_TRANSFER";
    if (label.includes("צ")) return "CHECK";
    return "OTHER";
  }
  return "OTHER";
}

export function buildDeviationSummary(rows: CashControlDeviationRow[]): DeviationSummaryRow[] {
  const totals = new Map<DeviationSummaryCategoryId, { count: number; totalUsd: number }>();
  for (const row of rows) {
    const cat = rowSummaryCategory(row);
    const cur = totals.get(cat) ?? { count: 0, totalUsd: 0 };
    cur.count += 1;
    cur.totalUsd = round2(cur.totalUsd + parseDeviationUsd(row.deviationUsd));
    totals.set(cat, cur);
  }
  return CATEGORY_META.map((meta) => {
    const t = totals.get(meta.id);
    return {
      id: meta.id,
      label: meta.label,
      count: t?.count ?? 0,
      totalUsd: t?.totalUsd ?? 0,
    };
  }).filter((r) => r.count > 0);
}

export function filterDeviationsByCategory(
  rows: CashControlDeviationRow[],
  categoryId: DeviationSummaryCategoryId,
): CashControlDeviationRow[] {
  return rows.filter((r) => rowSummaryCategory(r) === categoryId);
}

export function detailDeviationTypeLabel(row: CashControlDeviationRow): string {
  if (row.deviationType === "method" && row.methodLabel) return row.methodLabel;
  return row.typeLabel;
}

export function formatDeviationAmountUsd(row: CashControlDeviationRow): string {
  if (row.deviationType === "week") return "—";
  const n = parseDeviationUsd(row.deviationUsd);
  if (n <= 0) return row.deviationUsd === "—" ? "—" : `$${row.deviationUsd}`;
  return `+$${n.toFixed(2)}`;
}

export function orderMethodBreakdown(
  rows: CashControlDeviationRow[],
  orderId: string,
): CashControlDeviationRow["methodBreakdown"] {
  for (const r of rows) {
    if (r.orderId === orderId && r.methodBreakdown.length > 0) return r.methodBreakdown;
  }
  return [];
}
