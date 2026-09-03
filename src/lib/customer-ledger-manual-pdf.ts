import type { CustomerLedgerPayload, CustomerLedgerRow } from "@/lib/customer-account-ledger";
import { isLedgerDisplayOrderRow, isLedgerDisplayPaymentRow, sortLedgerRowsForDisplay } from "@/lib/customer-ledger-display";
import { parseMoneyStringOrZero } from "@/lib/money-format";

export type ManualLedgerPickKind = "orders" | "payments" | "fees_resets" | "all";

export type ManualLedgerSelectionSummary = {
  selectedCount: number;
  selectedChargesUsd: number;
  selectedPaymentsUsd: number;
  lastSelectedBalanceUsd: string;
  fromYmd: string;
  toYmd: string;
};

export function isLedgerFeeOrResetRow(row: CustomerLedgerRow): boolean {
  return (
    !!row.isCommissionDebtClosure ||
    !!row.isBalanceReset ||
    row.kind === "BALANCE_RESET" ||
    !!row.isAdjustmentFeeCapture
  );
}

export function ledgerRowMatchesManualPick(row: CustomerLedgerRow, kind: ManualLedgerPickKind): boolean {
  if (kind === "all") return true;
  if (kind === "orders") return isLedgerDisplayOrderRow(row);
  if (kind === "payments") return isLedgerDisplayPaymentRow(row);
  return isLedgerFeeOrResetRow(row);
}

/**
 * סינון שורות קיימות בלבד — לא replay.
 * היתרה על כל שורה נשארת כפי שחושבה בכרטסת המלאה.
 */
export function filterLedgerRowsBySelectedIds(
  rows: CustomerLedgerRow[] | null | undefined,
  selectedIds: readonly string[],
): { ok: true; rows: CustomerLedgerRow[] } | { ok: false; missingIds: string[] } {
  const source = rows ?? [];
  const byId = new Map(source.map((row) => [row.id, row]));
  const missingIds: string[] = [];
  const picked: CustomerLedgerRow[] = [];
  const seen = new Set<string>();
  for (const id of selectedIds) {
    const key = String(id ?? "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const row = byId.get(key);
    if (!row) {
      missingIds.push(key);
      continue;
    }
    picked.push(row);
  }
  if (missingIds.length > 0) return { ok: false, missingIds };
  return { ok: true, rows: picked };
}

export function sortSelectedLedgerRowsChronological(rows: CustomerLedgerRow[]): CustomerLedgerRow[] {
  return sortLedgerRowsForDisplay(rows, "old_new");
}

export function buildManualLedgerSelectionSummary(rows: CustomerLedgerRow[]): ManualLedgerSelectionSummary {
  const chronological = sortSelectedLedgerRowsChronological(rows);
  let selectedChargesUsd = 0;
  let selectedPaymentsUsd = 0;
  let fromYmd = "";
  let toYmd = "";
  for (const row of chronological) {
    if (row.kind !== "OPENING_BALANCE") {
      selectedChargesUsd += parseMoneyStringOrZero(row.chargeUsd);
      selectedPaymentsUsd += parseMoneyStringOrZero(row.paymentUsd);
    }
    if (row.dateYmd && row.dateYmd !== "—") {
      if (!fromYmd || row.dateYmd < fromYmd) fromYmd = row.dateYmd;
      if (!toYmd || row.dateYmd > toYmd) toYmd = row.dateYmd;
    }
  }
  const last = chronological[chronological.length - 1];
  return {
    selectedCount: chronological.length,
    selectedChargesUsd: Math.round((selectedChargesUsd + Number.EPSILON) * 100) / 100,
    selectedPaymentsUsd: Math.round((selectedPaymentsUsd + Number.EPSILON) * 100) / 100,
    lastSelectedBalanceUsd: last?.balanceUsd ?? "0.00",
    fromYmd,
    toYmd,
  };
}

export function applyManualLedgerSelection(
  ledger: CustomerLedgerPayload,
  selectedIds: readonly string[],
):
  | { ok: true; ledger: CustomerLedgerPayload; summary: ManualLedgerSelectionSummary }
  | { ok: false; missingIds: string[] } {
  const filtered = filterLedgerRowsBySelectedIds(ledger.rows, selectedIds);
  if (!filtered.ok) return filtered;
  const rows = sortSelectedLedgerRowsChronological(filtered.rows);
  const summary = buildManualLedgerSelectionSummary(rows);
  return {
    ok: true,
    summary,
    ledger: {
      ...ledger,
      rows,
    },
  };
}
