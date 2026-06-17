import { Prisma } from "@prisma/client";
import type { OrderEditDiffRow } from "@/lib/order-edit-snapshot";
import { filterSensitiveOrderEditDiff } from "@/lib/order-edit-approval";
import { formatUsdDisplay, parseMoneyStringOrZero } from "@/lib/money-format";
import { prisma } from "@/lib/prisma";

export const ORDER_UPDATE_LEDGER_KIND = "ORDER_UPDATE" as const;

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

export function buildOrderUpdateLedgerChanges(diff: OrderEditDiffRow[]): OrderUpdateLedgerChange[] {
  return filterSensitiveOrderEditDiff(diff).map((row) => ({
    field: row.key,
    label: row.label,
    before: row.before,
    after: row.after,
    deltaUsd:
      row.key === "amountUsd" || row.key === "feeUsd"
        ? moneyDelta(row.before, row.after)
        : null,
  }));
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
  const changes = buildOrderUpdateLedgerChanges(params.diff);
  if (!changes.length) return null;
  return {
    ledgerKind: ORDER_UPDATE_LEDGER_KIND,
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

export function parseOrderUpdateLedgerDetail(metadata: unknown): OrderUpdateLedgerDetail | null {
  if (!metadata || typeof metadata !== "object") return null;
  const meta = metadata as Record<string, unknown>;
  if (meta.ledgerKind !== ORDER_UPDATE_LEDGER_KIND) return null;
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
    changes.push({
      field: decStr(c.field) ?? label,
      label,
      before: decStr(c.before) ?? "—",
      after: decStr(c.after) ?? "—",
      deltaUsd: decStr(c.deltaUsd),
    });
  }
  if (!changes.length) return null;
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
