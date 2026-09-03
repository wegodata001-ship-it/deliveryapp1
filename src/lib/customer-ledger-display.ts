import type { CustomerLedgerRow } from "@/lib/customer-account-ledger";

export type CustomerLedgerQuickFilter = "all" | "payments" | "orders";
export type CustomerLedgerDateSort = "new_old" | "old_new";

/** ברירת מחדל בכל פתיחת כרטסת: ישן → חדש */
export const DEFAULT_CUSTOMER_LEDGER_DATE_SORT: CustomerLedgerDateSort = "old_new";

/** תשלום רגיל בלבד — ללא ביטולים ואיפוס יתרה */
export function isLedgerDisplayPaymentRow(row: CustomerLedgerRow): boolean {
  return row.kind === "PAYMENT" && row.typeLabel === "תשלום";
}

/** הזמנה רגילה או עדכון הזמנה — ללא משיכה מחוב, ביטולים ואיפוס */
export function isLedgerDisplayOrderRow(row: CustomerLedgerRow): boolean {
  if (row.isOrderUpdated) return true;
  return row.kind === "ORDER" && row.typeLabel === "הזמנה";
}

export function filterLedgerRowsForDisplay(
  rows: CustomerLedgerRow[] | null | undefined,
  filter: CustomerLedgerQuickFilter,
): CustomerLedgerRow[] {
  const safe = rows ?? [];
  if (filter === "all") return safe;
  if (filter === "payments") return safe.filter(isLedgerDisplayPaymentRow);
  return safe.filter(isLedgerDisplayOrderRow);
}

function compareLedgerDocumentAsc(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function compareLedgerDateAsc(a: string, b: string): number {
  if (a === "—" && b === "—") return 0;
  if (a === "—") return 1;
  if (b === "—") return -1;
  return a.localeCompare(b);
}

function ledgerOccurredAtMs(row: CustomerLedgerRow): number | null {
  const raw = row.occurredAtMs;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return null;
}

/**
 * מיון תצוגה כרונולוגי לפי תאריך התנועה.
 * באותו יום — createdAt / occurredAtMs, ואז מספר מסמך ו-id ליציבות.
 * ברירת מחדל: ישן → חדש.
 */
export function sortLedgerRowsForDisplay(
  rows: CustomerLedgerRow[] | null | undefined,
  sort: CustomerLedgerDateSort = DEFAULT_CUSTOMER_LEDGER_DATE_SORT,
): CustomerLedgerRow[] {
  const dir = sort === "old_new" ? 1 : -1;
  return [...(rows ?? [])].sort((a, b) => {
    const aOpen = a.kind === "OPENING_BALANCE" ? 1 : 0;
    const bOpen = b.kind === "OPENING_BALANCE" ? 1 : 0;
    if (aOpen !== bOpen) return (bOpen - aOpen) * dir;
    const byDate = compareLedgerDateAsc(a.dateYmd, b.dateYmd);
    if (byDate !== 0) return byDate * dir;
    const aMs = ledgerOccurredAtMs(a);
    const bMs = ledgerOccurredAtMs(b);
    if (aMs != null && bMs != null && aMs !== bMs) return (aMs - bMs) * dir;
    const byDoc = compareLedgerDocumentAsc(a.document, b.document);
    if (byDoc !== 0) return byDoc * dir;
    return a.id.localeCompare(b.id) * dir;
  });
}

export function prepareLedgerRowsForDisplay(
  rows: CustomerLedgerRow[] | null | undefined,
  filter: CustomerLedgerQuickFilter,
  sort: CustomerLedgerDateSort = DEFAULT_CUSTOMER_LEDGER_DATE_SORT,
): CustomerLedgerRow[] {
  return sortLedgerRowsForDisplay(filterLedgerRowsForDisplay(rows ?? [], filter), sort);
}
