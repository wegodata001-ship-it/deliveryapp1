import { Prisma } from "@prisma/client";
import type { OrderEditDiffRow } from "@/lib/order-edit-snapshot";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { prisma } from "@/lib/prisma";

export const ORDER_UPDATE_LEDGER_KIND = "ORDER_UPDATE" as const;

/** שדות שיוצרים אירוע פיננסי בכרטסת — לא הערות / תיאור / UI */
export const ORDER_LEDGER_FINANCIAL_FIELDS = [
  "amountUsd",
  "feeUsd",
  "commissionPercent",
  "paymentMethod",
  "paymentBreakdown",
  "usdRateUsed",
] as const;

const FINANCIAL_FIELD_SET = new Set<string>(ORDER_LEDGER_FINANCIAL_FIELDS);

const FINANCIAL_LABELS = new Set([
  "סכום ($)",
  "עמלה ($)",
  "אחוז עמלה",
  "אמצעי תשלום",
  "חלוקת אמצעי תשלום",
  "שער המרה",
]);

export type OrderUpdateLedgerChange = {
  field: string;
  label: string;
  before: string;
  after: string;
  deltaUsd: string | null;
};

export type OrderUpdateLedgerDetail = {
  orderNumber: string;
  requestedBy: string;
  approvedBy: string;
  changes: OrderUpdateLedgerChange[];
};

function moneyDelta(beforeRaw: string, afterRaw: string): string | null {
  const before = parseMoneyStringOrZero(beforeRaw.replace(/[$,\s]/g, ""));
  const after = parseMoneyStringOrZero(afterRaw.replace(/[$,\s]/g, ""));
  const delta = after - before;
  if (Math.abs(delta) <= 0.0001) return null;
  const sign = delta > 0 ? "+" : "-";
  return `${sign}${formatUsdDisplay(Math.abs(delta))}`;
}

export function isOrderLedgerFinancialField(field: string, label?: string): boolean {
  const f = (field ?? "").trim();
  const l = (label ?? "").trim();
  if (FINANCIAL_FIELD_SET.has(f) || FINANCIAL_LABELS.has(f)) return true;
  if (l && (FINANCIAL_FIELD_SET.has(l) || FINANCIAL_LABELS.has(l))) return true;
  return false;
}

export function orderUpdateHasFinancialChange(
  changes: Array<{ field?: string; label?: string }>,
): boolean {
  return changes.some((c) => isOrderLedgerFinancialField(c.field ?? "", c.label));
}

export function filterOrderUpdateFinancialChanges<T extends { field?: string; label?: string }>(
  changes: T[],
): T[] {
  return changes.filter((c) => isOrderLedgerFinancialField(c.field ?? "", c.label));
}

function rowToChange(row: OrderEditDiffRow): OrderUpdateLedgerChange {
  return {
    field: row.key,
    label: row.label,
    before: row.before,
    after: row.after,
    deltaUsd:
      row.key === "amountUsd" || row.key === "feeUsd" ? moneyDelta(row.before, row.after) : null,
  };
}

/** כל השינויים ל-Audit (כולל הערות). */
export function buildOrderUpdateAuditChanges(diff: OrderEditDiffRow[]): OrderUpdateLedgerChange[] {
  return diff.map(rowToChange);
}

/** שינויים פיננסיים בלבד — לכרטסת. */
export function buildOrderUpdateLedgerChanges(diff: OrderEditDiffRow[]): OrderUpdateLedgerChange[] {
  return filterOrderUpdateFinancialChanges(buildOrderUpdateAuditChanges(diff));
}

export function buildOrderUpdateAuditMetadata(params: {
  orderId: string;
  orderNumber: string;
  customerId: string;
  requestedBy: string | null;
  approvedBy: string;
  orderEditRequestId?: string | null;
  diff: OrderEditDiffRow[];
}): Record<string, unknown> | null {
  const changes = buildOrderUpdateAuditChanges(params.diff);
  if (!changes.length) return null;
  const financialLedger = orderUpdateHasFinancialChange(changes);
  return {
    ...(financialLedger ? { ledgerKind: ORDER_UPDATE_LEDGER_KIND } : {}),
    financialLedger,
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    customerId: params.customerId,
    requestedBy: params.requestedBy?.trim() || null,
    approvedBy: params.approvedBy.trim(),
    orderEditRequestId: params.orderEditRequestId?.trim() || null,
    changes,
  };
}

function decStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * כרטסת בלבד: מחזיר פירוט רק אם יש שינוי פיננסי מזוהה.
 * Audit ישן של הערות (ledgerKind + notes) מסונן כאן — בלי מחיקת ה-log.
 */
export function parseOrderUpdateLedgerDetail(metadata: unknown): OrderUpdateLedgerDetail | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  if (meta.financialLedger === false) return null;
  const orderNumber = decStr(meta.orderNumber);
  if (!orderNumber) return null;
  const rawChanges = meta.changes;
  if (!Array.isArray(rawChanges) || rawChanges.length === 0) return null;
  const changes: OrderUpdateLedgerChange[] = [];
  for (const item of rawChanges) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const label = decStr(c.label);
    if (!label) continue;
    const field = decStr(c.field) ?? label;
    if (!isOrderLedgerFinancialField(field, label)) continue;
    changes.push({
      field,
      label,
      before: decStr(c.before) ?? "—",
      after: decStr(c.after) ?? "—",
      deltaUsd: decStr(c.deltaUsd),
    });
  }
  if (!changes.length) return null;
  if (meta.ledgerKind !== ORDER_UPDATE_LEDGER_KIND && meta.financialLedger !== true) {
    return null;
  }
  return {
    orderNumber,
    requestedBy: decStr(meta.requestedBy) ?? "—",
    approvedBy: decStr(meta.approvedBy) ?? "—",
    changes,
  };
}

export type OrderUpdateAuditInput = {
  orderId: string;
  orderNumber: string;
  customerId: string;
  actorUserId: string;
  actorFullName: string;
  orderEditRequestId?: string | null;
  requestedByName?: string | null;
  diff: OrderEditDiffRow[];
};

export async function writeOrderUpdateAuditLog(input: OrderUpdateAuditInput): Promise<void> {
  const metadata = buildOrderUpdateAuditMetadata({
    orderId: input.orderId,
    orderNumber: input.orderNumber,
    customerId: input.customerId,
    requestedBy: input.requestedByName ?? input.actorFullName,
    approvedBy: input.actorFullName,
    orderEditRequestId: input.orderEditRequestId,
    diff: input.diff,
  });
  if (!metadata) return;
  await prisma.auditLog.create({
    data: {
      userId: input.actorUserId,
      actionType: "ORDER_UPDATED",
      entityType: "Order",
      entityId: input.orderId,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}
