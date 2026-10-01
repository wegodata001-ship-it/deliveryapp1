import { Prisma } from "@prisma/client";
import type { MethodBalanceRow } from "@/lib/payment-method-matching-engine";

export const ADJUSTMENT_SAVE_FAILED_USER_MESSAGE =
  "לא ניתן היה לשמור את ההתאמה. לא בוצעו שינויים.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EPS = 0.0001;

export function isPrismaMissingRecordError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    if ((error as { code?: string }).code === "P2025") return true;
  }
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return /No record was found for an update/i.test(msg) || /Record to update does not exist/i.test(msg);
}

export function isPersistedBreakdownId(id: string | null | undefined): boolean {
  const t = id?.trim() ?? "";
  if (!t) return false;
  if (t.startsWith("auto-adjust:")) return false;
  return UUID_RE.test(t);
}

export function breakdownPersistKey(
  orderId: string,
  paymentMethod: string,
  currency: string,
): string {
  const cur = currency.toUpperCase() === "ILS" ? "ILS" : "USD";
  return `${orderId}::${cur}::${paymentMethod}`;
}

export type ExistingBreakdownRow = {
  id: string;
  orderId: string;
  paymentMethod: string;
  currency: string;
};

export type BreakdownPaidPersistTarget =
  | { action: "update"; id: string; orderId: string; paymentMethod: string; currency: "USD" | "ILS" }
  | { action: "create"; orderId: string; paymentMethod: string; currency: "USD" | "ILS" }
  | { action: "skip" };

/**
 * Resolve persist action from freshly loaded DB rows.
 * Never trusts a client / matching-engine breakdownId unless it still exists.
 */
export function resolveBreakdownPaidPersistTarget(
  existing: ExistingBreakdownRow[],
  balance: Pick<MethodBalanceRow, "breakdownId" | "orderId" | "method" | "currency" | "planned" | "paid" | "remaining">,
  usedIds: Set<string>,
): BreakdownPaidPersistTarget {
  const currency = balance.currency === "ILS" ? "ILS" : "USD";
  const method = balance.method.trim();
  const orderId = balance.orderId.trim();
  if (!orderId || !method) return { action: "skip" };

  const hinted = isPersistedBreakdownId(balance.breakdownId)
    ? existing.find((row) => row.id === balance.breakdownId && !usedIds.has(row.id))
    : undefined;
  if (hinted) {
    return {
      action: "update",
      id: hinted.id,
      orderId,
      paymentMethod: method,
      currency,
    };
  }

  const key = breakdownPersistKey(orderId, method, currency);
  const byKey = existing.find((row) => {
    if (usedIds.has(row.id)) return false;
    return breakdownPersistKey(row.orderId, row.paymentMethod, row.currency) === key;
  });
  if (byKey) {
    return {
      action: "update",
      id: byKey.id,
      orderId,
      paymentMethod: method,
      currency,
    };
  }

  const needsRow =
    Math.abs(balance.planned) > EPS ||
    Math.abs(balance.paid) > EPS ||
    Math.abs(balance.remaining) > EPS;
  if (!needsRow) return { action: "skip" };
  return { action: "create", orderId, paymentMethod: method, currency };
}

export async function persistMatchingBreakdownPaidInTx(
  tx: Prisma.TransactionClient,
  balances: MethodBalanceRow[],
  ctx?: {
    paymentId?: string | null;
    paymentCode?: string | null;
    weekCode?: string | null;
  },
): Promise<void> {
  const orderIds = [...new Set(balances.map((row) => row.orderId).filter(Boolean))];
  if (orderIds.length === 0) return;

  const existing = await tx.orderPaymentBreakdown.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true, orderId: true, paymentMethod: true, currency: true },
  });
  const usedIds = new Set<string>();

  for (const bal of balances) {
    const target = resolveBreakdownPaidPersistTarget(existing, bal, usedIds);
    const paidDec = new Prisma.Decimal(bal.paid.toFixed(4));
    const remDec = new Prisma.Decimal(Math.max(0, bal.remaining).toFixed(4));
    const plannedDec = new Prisma.Decimal(Math.max(0, bal.planned).toFixed(4));

    if (target.action === "skip") continue;

    if (target.action === "update") {
      usedIds.add(target.id);
      try {
        await tx.orderPaymentBreakdown.update({
          where: { id: target.id },
          data: { paidAmount: paidDec, remainingAmount: remDec },
        });
      } catch (error) {
        if (!isPrismaMissingRecordError(error)) throw error;
        console.error("[payment-intake] BREAKDOWN_UPDATE_MISSING_FALLBACK_CREATE", {
          paymentId: ctx?.paymentId ?? null,
          paymentCode: ctx?.paymentCode ?? null,
          weekCode: ctx?.weekCode ?? null,
          orderId: target.orderId,
          breakdownId: target.id,
          paymentMethod: target.paymentMethod,
          currency: target.currency,
          plannedAmount: bal.planned,
          actualAmount: bal.paid,
          whereClauseUsed: { id: target.id },
          recordExisted: false,
        });
        await tx.orderPaymentBreakdown.create({
          data: {
            orderId: target.orderId,
            paymentMethod: target.paymentMethod,
            amount: plannedDec,
            currency: target.currency,
            paidAmount: paidDec,
            remainingAmount: remDec,
          },
        });
      }
      continue;
    }

    if (bal.breakdownId && !isPersistedBreakdownId(bal.breakdownId)) {
      console.error("[payment-intake] BREAKDOWN_PERSIST_STALE_ID", {
        paymentId: ctx?.paymentId ?? null,
        paymentCode: ctx?.paymentCode ?? null,
        weekCode: ctx?.weekCode ?? null,
        orderId: bal.orderId,
        breakdownId: bal.breakdownId,
        paymentMethod: bal.method,
        currency: bal.currency,
        plannedAmount: bal.planned,
        actualAmount: bal.paid,
        whereClauseRejected: { id: bal.breakdownId },
        recordExisted: false,
        strategy: "create-by-authoritative-key",
      });
    }

    await tx.orderPaymentBreakdown.create({
      data: {
        orderId: target.orderId,
        paymentMethod: target.paymentMethod,
        amount: plannedDec,
        currency: target.currency,
        paidAmount: paidDec,
        remainingAmount: remDec,
      },
    });
  }
}
