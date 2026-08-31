/**
 * SSOT — עמלה להזמנה:
 * currentFee = baseCommissionUsd (Order.commissionUsd) + Σ(PaymentAdjustmentFee שאינן legacy)
 *
 * Order.commissionUsd = עמלה בסיסית (מקורית / כפי שנשמרה על ההזמנה).
 * PaymentAdjustmentFee = תוספות/הפחתות מצטברות (עודף→עמלה, איפוס מיתרת עמלה, וכו').
 * fee_adjustment_negative (legacy) כבר משוקף ב-commissionUsd — לא מכפילים.
 */
import { roundOrderMoney2 } from "@/lib/order-remaining-debt";
import { isLegacyCommissionOrderMutationFee } from "@/lib/customer-commission-balance-shared";
import {
  commissionKindFromAmount,
  commissionReasonLabel,
  commissionTypeLabel,
  COMMISSION_TYPE_ORIGINAL,
  type CommissionLineageRow,
  type CommissionMovementKind,
} from "@/lib/commission-lineage-view";

const EPS = 0.01;

export type OrderCommissionFeeMovementInput = {
  id: string;
  amountUsd: number;
  userChoice: string | null;
  reason?: string | null;
  createdAt?: string | Date | null;
  paymentId?: string | null;
  paymentCaptureCode?: string | null;
  paymentCode?: string | null;
  orderId?: string | null;
  orderNumber?: string | null;
  notes?: string | null;
  createdByName?: string | null;
};

export type OrderCommissionBreakdown = {
  orderId: string;
  /** Order.commissionUsd — בסיס */
  baseCommissionUsd: number;
  /** Σ התאמות (ללא legacy) */
  adjustmentsUsd: number;
  /** base + adjustments */
  currentCommissionUsd: number;
  hasAdjustments: boolean;
};

export type OrderCommissionMovementView = CommissionLineageRow & {
  label: string;
  notes: string | null;
};

export type OrderCommissionDetailView = OrderCommissionBreakdown & {
  orderNumber: string | null;
  movements: OrderCommissionMovementView[];
};

export function sumOrderCommissionAdjustmentsUsd(
  fees: Array<{ amountUsd: number; userChoice?: string | null }>,
): number {
  let sum = 0;
  for (const fee of fees) {
    if (isLegacyCommissionOrderMutationFee(fee.userChoice)) continue;
    const n = Number(fee.amountUsd);
    if (!Number.isFinite(n)) continue;
    sum += n;
  }
  return roundOrderMoney2(sum);
}

export function computeOrderCommissionBreakdown(params: {
  orderId: string;
  baseCommissionUsd: number;
  fees: Array<{ amountUsd: number; userChoice?: string | null }>;
}): OrderCommissionBreakdown {
  const baseCommissionUsd = roundOrderMoney2(Number(params.baseCommissionUsd) || 0);
  const adjustmentsUsd = sumOrderCommissionAdjustmentsUsd(params.fees);
  const currentCommissionUsd = roundOrderMoney2(baseCommissionUsd + adjustmentsUsd);
  return {
    orderId: params.orderId,
    baseCommissionUsd,
    adjustmentsUsd,
    currentCommissionUsd,
    hasAdjustments: Math.abs(adjustmentsUsd) > EPS,
  };
}

function feeMovementKind(amountUsd: number): CommissionMovementKind {
  return commissionKindFromAmount(amountUsd, false);
}

function toYmd(raw: string | Date | null | undefined): string {
  if (!raw) return "—";
  if (typeof raw === "string") return raw.slice(0, 10);
  return raw.toISOString().slice(0, 10);
}

export function buildOrderCommissionDetailView(params: {
  orderId: string;
  orderNumber: string | null;
  baseCommissionUsd: number;
  fees: OrderCommissionFeeMovementInput[];
}): OrderCommissionDetailView {
  const breakdown = computeOrderCommissionBreakdown({
    orderId: params.orderId,
    baseCommissionUsd: params.baseCommissionUsd,
    fees: params.fees,
  });

  const movements: OrderCommissionMovementView[] = [];
  if (Math.abs(breakdown.baseCommissionUsd) > EPS || breakdown.hasAdjustments) {
    movements.push({
      id: `base:${params.orderId}`,
      dateYmd: "",
      kind: "ORIGINAL",
      typeLabel: COMMISSION_TYPE_ORIGINAL,
      label: COMMISSION_TYPE_ORIGINAL,
      amountUsd: breakdown.baseCommissionUsd,
      sourceDocument: params.orderNumber,
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      paymentId: null,
      paymentCode: null,
      reason: null,
      createdByName: null,
      notes: null,
    });
  }
  const feeMovements: OrderCommissionMovementView[] = [];
  for (const fee of params.fees) {
    if (isLegacyCommissionOrderMutationFee(fee.userChoice)) continue;
    const amountUsd = roundOrderMoney2(Number(fee.amountUsd) || 0);
    if (Math.abs(amountUsd) <= EPS) continue;
    const kind = feeMovementKind(amountUsd);
    const typeLabel = commissionTypeLabel(kind);
    const paymentCode =
      fee.paymentCaptureCode?.trim() ||
      fee.paymentCode?.trim() ||
      null;
    feeMovements.push({
      id: fee.id,
      dateYmd: toYmd(fee.createdAt),
      kind,
      typeLabel,
      label: typeLabel,
      amountUsd,
      sourceDocument: paymentCode ?? params.orderNumber,
      orderId: fee.orderId ?? params.orderId,
      orderNumber: fee.orderNumber ?? params.orderNumber,
      paymentId: fee.paymentId ?? null,
      paymentCode,
      reason: commissionReasonLabel({ reason: fee.reason, userChoice: fee.userChoice }),
      createdByName: fee.createdByName?.trim() || null,
      notes: fee.notes?.trim() || null,
    });
  }

  feeMovements.sort((a, b) => a.dateYmd.localeCompare(b.dateYmd) || a.id.localeCompare(b.id));
  movements.push(...feeMovements);

  return {
    ...breakdown,
    orderNumber: params.orderNumber,
    movements,
  };
}

/** מפת הזמנה → פירוט עמלה נוכחית */
export function indexOrderCommissionBreakdowns(
  orders: Array<{ id: string; commissionUsd: number }>,
  fees: Array<{ orderId: string | null; amountUsd: number; userChoice?: string | null }>,
): Map<string, OrderCommissionBreakdown> {
  const feesByOrder = new Map<string, Array<{ amountUsd: number; userChoice?: string | null }>>();
  for (const fee of fees) {
    if (!fee.orderId) continue;
    const list = feesByOrder.get(fee.orderId) ?? [];
    list.push({ amountUsd: fee.amountUsd, userChoice: fee.userChoice });
    feesByOrder.set(fee.orderId, list);
  }
  const out = new Map<string, OrderCommissionBreakdown>();
  for (const order of orders) {
    out.set(
      order.id,
      computeOrderCommissionBreakdown({
        orderId: order.id,
        baseCommissionUsd: order.commissionUsd,
        fees: feesByOrder.get(order.id) ?? [],
      }),
    );
  }
  return out;
}

/** אגרגציה לרמת לקוח מפירוטי הזמנות */
export function summarizeCustomerOrderCommissions(
  rows: OrderCommissionBreakdown[],
): { baseUsd: number; adjustmentsUsd: number; currentUsd: number } {
  let baseUsd = 0;
  let adjustmentsUsd = 0;
  let currentUsd = 0;
  for (const row of rows) {
    baseUsd += row.baseCommissionUsd;
    adjustmentsUsd += row.adjustmentsUsd;
    currentUsd += row.currentCommissionUsd;
  }
  return {
    baseUsd: roundOrderMoney2(baseUsd),
    adjustmentsUsd: roundOrderMoney2(adjustmentsUsd),
    currentUsd: roundOrderMoney2(currentUsd),
  };
}
