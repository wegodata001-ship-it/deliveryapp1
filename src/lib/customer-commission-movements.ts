/**
 * SSOT תנועות עמלה — אותה רשימה ליתרה ולפירוט.
 * Fee Balance = SUM(active movements). CANCELLED נשמר בהיסטוריה ולא נספר.
 */
import { roundOrderMoney2 } from "@/lib/order-remaining-debt";
import {
  COMMISSION_POOL_DEBIT_USER_CHOICE,
  isLegacyCommissionOrderMutationFee,
} from "@/lib/customer-commission-balance-shared";
import {
  COMMISSION_TYPE_ORIGINAL,
  commissionKindFromAmount,
  commissionMovementActionLabel,
  commissionReasonLabel,
  type CommissionMovementKind,
} from "@/lib/commission-lineage-view";
import { CREDIT_TO_COMMISSION_USER_CHOICE } from "@/lib/customer-account-reset";
import { formatLocalYmd } from "@/lib/work-week";

export type CommissionMovementType =
  | "ORDER_COMMISSION"
  | "OVERPAYMENT_TO_COMMISSION"
  | "DEBT_RESET_FROM_COMMISSION"
  | "MANUAL_COMMISSION_ADJUSTMENT"
  | "BALANCE_RESET_OVERPAYMENT_TO_COMMISSION"
  | "CREDIT_RESET_TO_COMMISSION";

export type CommissionMovementDirection = "CREDIT" | "DEBIT";

export type CommissionMovementRow = {
  id: string;
  customerId: string;
  dateYmd: string;
  createdAt: string;
  type: CommissionMovementType;
  kind: CommissionMovementKind;
  actionLabel: string;
  sourceType: "ORDER" | "PAYMENT" | "FEE" | "MANUAL";
  sourceId: string | null;
  paymentId: string | null;
  paymentCode: string | null;
  orderId: string | null;
  orderNumber: string | null;
  sourceDocument: string;
  amountUsd: number;
  direction: CommissionMovementDirection;
  reason: string | null;
  balanceAfterUsd: number;
  createdById: string | null;
  createdByName: string | null;
  /** מבוטל — בהיסטוריה, לא ב-running הפעיל */
  isCancelled?: boolean;
};

export type CommissionOrderSource = {
  id: string;
  orderNumber: string | null;
  orderDate: Date | null;
  createdAt: Date;
  commissionUsd: unknown;
};

export type CommissionFeeSource = {
  id: string;
  orderId: string | null;
  paymentId: string | null;
  paymentCaptureCode: string | null;
  sourceDocumentCode: string | null;
  amountUsd: unknown;
  reason: string;
  userChoice: string | null;
  notes: string | null;
  status: string;
  createdAt: Date;
  createdById: string | null;
  createdBy?: { fullName: string | null } | null;
  payment?: { paymentCode: string | null } | null;
};

const EPS = 0.001;

function movementDirection(amountUsd: number): CommissionMovementDirection {
  return amountUsd >= -EPS ? "CREDIT" : "DEBIT";
}

function feeMovementType(input: {
  amountUsd: number;
  reason: string;
  userChoice: string | null;
}): CommissionMovementType {
  const choice = (input.userChoice ?? "").trim();
  if (choice === "commission" || input.reason === "PAYMENT_SURPLUS") {
    return "OVERPAYMENT_TO_COMMISSION";
  }
  if (choice === CREDIT_TO_COMMISSION_USER_CHOICE) {
    return "CREDIT_RESET_TO_COMMISSION";
  }
  if (choice === COMMISSION_POOL_DEBIT_USER_CHOICE || choice === "fee_adjustment_negative") {
    return "DEBT_RESET_FROM_COMMISSION";
  }
  if (input.reason === "MANUAL_ADJUST") return "MANUAL_COMMISSION_ADJUSTMENT";
  return input.amountUsd >= -EPS
    ? "OVERPAYMENT_TO_COMMISSION"
    : "DEBT_RESET_FROM_COMMISSION";
}

export function sumActiveCommissionMovementUsd(movements: CommissionMovementRow[]): number {
  let sum = 0;
  for (const row of movements) {
    if (row.isCancelled) continue;
    sum += Number(row.amountUsd) || 0;
  }
  return roundOrderMoney2(sum);
}

/** אותם מקורות כמו getCustomerCommissionBalancesUsdMany — כולל הזמנות משיכה. */
export function projectCustomerCommissionMovements(input: {
  customerId: string;
  orders: CommissionOrderSource[];
  fees: CommissionFeeSource[];
}): CommissionMovementRow[] {
  const cid = input.customerId.trim();
  type Raw = Omit<CommissionMovementRow, "balanceAfterUsd"> & { sortDate: Date };
  const raw: Raw[] = [];
  const orderNumberById = new Map(
    input.orders.map((o) => [o.id, o.orderNumber?.trim() || o.id.slice(0, 8)] as const),
  );

  for (const o of input.orders) {
    const com = roundOrderMoney2(Number(o.commissionUsd ?? 0));
    if (Math.abs(com) <= EPS) continue;
    const sortDate = o.orderDate ?? o.createdAt;
    const orderNumber = o.orderNumber?.trim() || o.id.slice(0, 8);
    raw.push({
      id: `order-${o.id}`,
      customerId: cid,
      dateYmd: formatLocalYmd(sortDate),
      createdAt: sortDate.toISOString(),
      type: "ORDER_COMMISSION",
      kind: "ORIGINAL",
      actionLabel: COMMISSION_TYPE_ORIGINAL,
      sourceType: "ORDER",
      sourceId: o.id,
      paymentId: null,
      paymentCode: null,
      orderId: o.id,
      orderNumber,
      sourceDocument: orderNumber,
      amountUsd: com,
      direction: "CREDIT",
      reason: null,
      createdById: null,
      createdByName: null,
      sortDate,
    });
  }

  for (const f of input.fees) {
    if (isLegacyCommissionOrderMutationFee(f.userChoice)) continue;
    const amount = roundOrderMoney2(Number(f.amountUsd ?? 0));
    if (Math.abs(amount) <= EPS) continue;
    const cancelled = (f.status ?? "").trim().toUpperCase() === "CANCELLED";
    const type = feeMovementType({
      amountUsd: amount,
      reason: f.reason,
      userChoice: f.userChoice,
    });
    const paymentCode =
      f.paymentCaptureCode?.trim() ||
      f.payment?.paymentCode?.trim() ||
      f.sourceDocumentCode?.trim() ||
      null;
    const orderNumber = f.orderId ? (orderNumberById.get(f.orderId) ?? null) : null;
    raw.push({
      id: `fee-${f.id}`,
      customerId: cid,
      dateYmd: formatLocalYmd(f.createdAt),
      createdAt: f.createdAt.toISOString(),
      type,
      kind: commissionKindFromAmount(amount, false),
      actionLabel: commissionMovementActionLabel({ amountUsd: amount, userChoice: f.userChoice }),
      sourceType: f.paymentId ? "PAYMENT" : f.orderId ? "ORDER" : "FEE",
      sourceId: f.paymentId ?? f.orderId ?? f.id,
      paymentId: f.paymentId,
      paymentCode,
      orderId: f.orderId,
      orderNumber,
      sourceDocument: paymentCode || orderNumber || f.id.slice(0, 8),
      amountUsd: amount,
      direction: movementDirection(amount),
      reason: commissionReasonLabel({ reason: f.reason, userChoice: f.userChoice }),
      createdById: f.createdById,
      createdByName: f.createdBy?.fullName?.trim() || null,
      isCancelled: cancelled || undefined,
      sortDate: f.createdAt,
    });
  }

  raw.sort((a, b) => {
    const dt = a.sortDate.getTime() - b.sortDate.getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });

  let running = 0;
  return raw.map((row) => {
    if (!row.isCancelled) {
      running = roundOrderMoney2(running + row.amountUsd);
    }
    const { sortDate: _sortDate, ...rest } = row;
    void _sortDate;
    return { ...rest, balanceAfterUsd: running };
  });
}

