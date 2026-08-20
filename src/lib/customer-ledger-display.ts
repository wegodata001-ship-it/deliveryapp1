import type { CustomerLedgerRow } from "@/lib/customer-account-ledger";

export type CustomerLedgerQuickFilter = "all" | "payments" | "orders";
export type CustomerLedgerDateSort = "new_old" | "old_new";

/** תשלום רגיל בלבד — ללא ביטולים ואיפוס יתרה */
export function isLedgerDisplayPaymentRow(row: CustomerLedgerRow): boolean {
  return row.kind === "PAYMENT" && row.typeLabel === "תשלום";
}

/** הזמנה רגילה בלבד — ללא משיכה מחוב, ביטולים ואיפוס */
export function isLedgerDisplayOrderRow(row: CustomerLedgerRow): boolean {
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

function compareLedgerDocumentDesc(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" });
}

function compareLedgerDateDesc(a: string, b: string): number {
  if (a === "—" && b === "—") return 0;
  if (a === "—") return 1;
  if (b === "—") return -1;
  return b.localeCompare(a);
}

function compareLedgerDateAsc(a: string, b: string): number {
  if (a === "—" && b === "—") return 0;
  if (a === "—") return 1;
  if (b === "—") return -1;
  return a.localeCompare(b);
}

/** מיון תצוגה: תאריך, ואז מסמך. ברירת מחדל חדש למעלה. */
export function sortLedgerRowsForDisplay(
  rows: CustomerLedgerRow[] | null | undefined,
  sort: CustomerLedgerDateSort = "new_old",
): CustomerLedgerRow[] {
  return [...(rows ?? [])].sort((a, b) => {
    const byDate =
      sort === "old_new"
        ? compareLedgerDateAsc(a.dateYmd, b.dateYmd)
        : compareLedgerDateDesc(a.dateYmd, b.dateYmd);
    if (byDate !== 0) return byDate;
    return sort === "old_new"
      ? compareLedgerDocumentDesc(b.document, a.document)
      : compareLedgerDocumentDesc(a.document, b.document);
  });
}

export function prepareLedgerRowsForDisplay(
  rows: CustomerLedgerRow[] | null | undefined,
  filter: CustomerLedgerQuickFilter,
  sort: CustomerLedgerDateSort = "new_old",
): CustomerLedgerRow[] {
  return sortLedgerRowsForDisplay(filterLedgerRowsForDisplay(rows ?? [], filter), sort);
}
